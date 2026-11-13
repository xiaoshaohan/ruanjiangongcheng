// 声明式请求体校验中间件
// 用法：router.post('/', validate({ student_id: { required: true, label: '学号' } }), handler)

const { fail } = require('./response');

/**
 * @param {Object} rules 字段名 -> 规则
 * 规则支持：
 *   required   是否必填
 *   label      报错时显示的中文名
 *   type       'number' | 'string'
 *   min / max  数值范围
 *   maxLength  字符串最大长度
 *   enum       允许的枚举值数组
 */
function validate(rules) {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rule] of Object.entries(rules)) {
      const label = rule.label || field;
      const value = req.body[field];

      // 必填校验
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`${label}不能为空`);
        continue;
      }

      // 非必填且未提供，跳过后续校验
      if (value === undefined || value === null || value === '') continue;

      // 数值校验
      if (rule.type === 'number') {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          errors.push(`${label}必须是数字`);
          continue;
        }
        if (rule.min !== undefined && num < rule.min) {
          errors.push(`${label}不能小于${rule.min}`);
        }
        if (rule.max !== undefined && num > rule.max) {
          errors.push(`${label}不能大于${rule.max}`);
        }
        req.body[field] = num; // 统一转成数字，避免 DECIMAL 字符串问题
        continue;
      }

      // 字符串校验
      if (rule.type === 'string') {
        const str = String(value).trim();
        if (rule.maxLength && str.length > rule.maxLength) {
          errors.push(`${label}长度不能超过${rule.maxLength}个字符`);
        }
        req.body[field] = str;
      }

      // 枚举校验
      if (rule.enum && !rule.enum.includes(value)) {
        errors.push(`${label}只能是：${rule.enum.join(' / ')}`);
      }
    }

    if (errors.length > 0) {
      return fail(res, 400, 400, errors[0]);
    }
    next();
  };
}

module.exports = { validate };
