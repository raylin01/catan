export function decisionTimeout(value = 60000) {
  const timeout = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 600000)
    throw Error('Decision timeout must be an integer between 1000 and 600000 milliseconds');
  return timeout;
}
