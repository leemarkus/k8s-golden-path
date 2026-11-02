// Canonical scaffold placeholder contract; render remains a reusable scalar renderer.
export const placeholders = Object.freeze([
  'tenant', 'kind', 'env', 'image', 'image_digest', 'image_tag', 'host', 'port',
  'health_path', 'priority_class', 'run_as_user', 'slo_availability', 'slo_latency', 'slo_latency_seconds',
]);

/** Plain text only: callers supply values appropriate to their target syntax. */
export function render(source, values, { forgejoExpressions = false } = {}) {
  // Opt-in for workflow content only; ordinary templates retain strict semantics.
  if (source.includes('\u0000')) throw new Error('NUL in template');
  if (Object.hasOwn(values, 'image_digest') && (typeof values.image_digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(values.image_digest))) {
    throw new Error('image_digest must be sha256 followed by 64 lowercase hex characters');
  }
  const expressions = [];
  if (forgejoExpressions) source = source.replace(/\$\{\{([^{}]+)\}\}/g, expression => {
    expressions.push(expression);
    return `\u0000GP_EXPRESSION_${expressions.length - 1}\u0000`;
  });
  const output = source.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown placeholder: ${key}`);
    if (!['string', 'number', 'boolean'].includes(typeof values[key])) {
      throw new Error(`Non-scalar placeholder: ${key}`);
    }
    return String(values[key]);
  });
  if (output.includes('{{')) throw new Error('Leftover {{ after rendering');
  return output.replace(/\u0000GP_EXPRESSION_(\d+)\u0000/g, (_, index) => {
    if (!forgejoExpressions || !expressions[Number(index)]) throw new Error('Invalid expression marker');
    return expressions[Number(index)];
  });
}
