// The LLM brain. Two providers, auto-detected:
//   1. any OpenAI-COMPATIBLE chat API (LLM_BASE_URL + optional LLM_API_KEY):
//      OpenAI, OpenRouter, Groq, Together, local llama.cpp server / LM
//      Studio / vLLM — anything speaking POST {base}/chat/completions with
//      `tools`;
//   2. Ollama's native /api/chat (OLLAMA_URL) when no OpenAI-style URL is
//      configured.
// With neither reachable the agent runs on the deterministic intent brain —
// the dialogue is identical, only the free-conversation quality differs.
//
// SAFETY: the confirmation protocol never depends on the model. Yes/no while
// confirming are matched literally by the Supervisor; record_sale refuses
// unless the Supervisor opened the gate. The system prompt constrains the
// model to the tools, but the enforcement is not the prompt.

import { TOOL_SCHEMAS } from './tools.js';
import { phrases } from './phrases.js';
import { cartTotal } from './cartMath.js';

const SYSTEM_PROMPT = `You are the cafe counter assistant inside Student Panel.
Languages: reply in the language of the user's last utterance — Persian (fa) or English (en). Persian is the default.
Rules:
- Use the TOOLS for all data: products, students, balances, cart, sale, void, report. Never invent products, names, prices or balances.
- Money is Toman whole numbers. Speak totals exactly as the tools returned them.
- Overdraft is allowed: read a negative balance plainly as debt ("X toman بدهکار" / "X toman in debt").
- To record a sale: build the cart with add_to_cart, call request_confirmation, and wait for the user's explicit confirmation. The record_sale tool refuses unless the supervisor opened the gate — if it refuses, tell the user the confirmation didn't complete. Never claim a sale was recorded unless record_sale returned ok.
- Keep answers short and spoken-style: one or two sentences. No lists, no markdown.
- If the user asks for something no tool can do, say you can't and suggest the screen.`;

export async function createLlmBrain(config) {
  const provider = detectProvider(config);
  if (!provider) {
    return { available: false, label: 'rules' };
  }
  if (provider.kind === 'ollama' && config.llmProvider === 'auto') {
    try {
      const probe = await fetch(`${provider.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!probe.ok) return { available: false, label: 'rules' };
    } catch {
      return { available: false, label: 'rules' };
    }
  }

  async function chat(messages) {
    if (provider.kind === 'openai') {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          tools: TOOL_SCHEMAS,
          temperature: 0.2,
        }),
      });
      if (!response.ok) {
        throw new Error(`LLM HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      const data = await response.json();
      return data.choices?.[0]?.message ?? null;
    }

    // Ollama native
    const response = await fetch(`${provider.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        messages,
        tools: TOOL_SCHEMAS,
        stream: false,
        options: { temperature: 0.2 },
      }),
    });
    if (!response.ok) {
      throw new Error(`LLM HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const data = await response.json();
    return data.message ?? null;
  }

  return {
    available: true,
    label: `${provider.kind}:${provider.model}`,
    async respond({ text, state, handlers, lang }) {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...state.history,
        { role: 'user', content: text },
      ];
      // Bound the tool loop: a model that keeps calling tools without
      // answering loses the turn (the intent brain stays the fallback).
      for (let hop = 0; hop < 6; hop += 1) {
        const message = await chat(messages);
        if (!message) break;
        const calls = message.tool_calls ?? [];
        if (calls.length === 0) {
          const spoken = String(message.content ?? '').trim();
          return spoken ? { handled: true, spoken } : { handled: false };
        }
        messages.push(message);
        for (const call of calls) {
          const name = call.function?.name;
          let args = call.function?.arguments ?? {};
          if (typeof args === 'string') {
            try {
              args = JSON.parse(args);
            } catch {
              args = {};
            }
          }
          const handler = handlers[name];
          let result;
          try {
            result = handler
              ? await handler(args)
              : { ok: false, reason: 'unknown_tool' };
          } catch (err) {
            result = { ok: false, error: err.message };
          }
          if (name === 'request_confirmation' && result.ok && state.phase === 'confirming') {
            // Nudge the model to stop and wait: the protocol is read-back +
            // literal yes, not a same-turn chain. The ask is composed by the
            // phrase catalogue, never paraphrased by the model.
            return { handled: true, spoken: confirmLine(state, lang) };
          }
          if (name === 'record_sale' && result.ok) {
            return {
              handled: true,
              spoken: saleRecordedSpoken(result, lang),
            };
          }
          messages.push({
            role: 'tool',
            ...(provider.kind === 'openai' && call.id ? { tool_call_id: call.id } : {}),
            content: JSON.stringify(result),
          });
        }
      }
      return { handled: false };
    },
  };
}

function detectProvider(config) {
  if (config.llmProvider === 'none') return null;
  if (config.llmBaseUrl) {
    return {
      kind: 'openai',
      baseUrl: config.llmBaseUrl.replace(/\/+$/, ''),
      apiKey: config.llmApiKey ?? '',
      model: config.llmModel,
    };
  }
  if (config.llmProvider === 'openai') {
    throw new Error('LLM_PROVIDER=openai needs LLM_BASE_URL');
  }
  if (config.llmProvider === 'ollama' || config.ollamaUrl) {
    return {
      kind: 'ollama',
      baseUrl: config.ollamaUrl,
      model: config.ollamaModel,
    };
  }
  return null;
}

// The two protocol sentences are composed by the SAME phrase catalogues the
// intent brain uses, so the model never paraphrases the money moments.
function confirmLine(state, lang) {
  const t = phrases(lang);
  const lines = state.cart.map((line) =>
    `${Number.isInteger(line.qty) ? line.qty : line.qty.toFixed(3)} ${line.productName}`
  );
  return t.cartDescription(lines, state.student?.name ?? null, cartTotal(state));
}

function saleRecordedSpoken(result, lang) {
  const t = phrases(lang);
  return t.saleRecorded(result.total, result.balanceAfter);
}
