import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function InstallAppPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const { i18n } = useTranslation();
  const isFa = i18n.language === 'fa';

  useEffect(() => {
    // Check if already installed / in standalone mode
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    if (isStandalone) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Check if user dismissed recently
      const dismissedUntil = localStorage.getItem('pwa_prompt_dismissed');
      if (!dismissedUntil || Date.now() > Number(dismissedUntil)) {
        setVisible(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!visible || !deferredPrompt) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setVisible(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setVisible(false);
    // Suppress for 7 days
    localStorage.setItem('pwa_prompt_dismissed', String(Date.now() + 7 * 86400000));
  };

  return (
    <div
      role="banner"
      className="fixed bottom-4 inset-x-4 md:inset-x-auto md:end-6 md:w-96 z-50 p-4 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-2xl border border-indigo-200/50 dark:border-indigo-800/40 text-slate-800 dark:text-slate-100 flex items-center gap-3.5 animate-in fade-in slide-in-from-bottom-3 duration-300"
    >
      <div className="w-11 h-11 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-md shadow-indigo-600/25">
        <svg
          className="w-6 h-6 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">
          {isFa ? 'نصب برنامه روی گوشی' : 'Install Android App'}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
          {isFa
            ? 'دسترسی سریع و تمام‌صفحه از صفحه اصلی'
            : 'Fast standalone home-screen experience'}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleInstall}
          className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
        >
          {isFa ? 'نصب' : 'Install'}
        </button>
        <button
          onClick={handleDismiss}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
          title={isFa ? 'بعداً' : 'Dismiss'}
          aria-label={isFa ? 'بعداً' : 'Dismiss'}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
