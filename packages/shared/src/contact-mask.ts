export function maskEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at <= 0) return '***';

  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (/^[^@]{1,2}\*+@[^@]+$/.test(value)) return value;
  return `${Array.from(local).slice(0, 2).join('')}***${domain}`;
}

export function maskPhone(value: string): string {
  if (/^\+\d{1,2}\*+\d{2}$/.test(value)) return value;
  const digits = value.startsWith('+') ? value.slice(1) : '';
  if (!/^\d{8,15}$/.test(digits)) return '***';
  return `+${digits.slice(0, 2)}${'*'.repeat(digits.length - 4)}${digits.slice(-2)}`;
}
