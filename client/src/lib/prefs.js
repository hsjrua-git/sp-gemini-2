export function visibleParameters(parameters, hiddenIds) {
  const hidden = new Set(hiddenIds);
  return parameters.filter((parameter) => !hidden.has(parameter.id));
}

export function toggleHidden(hiddenIds, parameterId, shouldShow) {
  const others = hiddenIds.filter((id) => id !== parameterId);
  return shouldShow ? others : [...others, parameterId];
}