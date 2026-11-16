// 声明式请求体校验中间件
// 用法：router.post('/', validate({ student_id: { required: true, label: '学号' } }), handler)

const { fail } = require('./response');

// 真实存在的日期（排除 2024-02-30、2024-13-45 这类）
function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === value;
}

/**
 * @param {Object} rules 字段名 -> 规则
 * 规则支持：
 *   required   是否必填
 *   label      报错时显示的中文名
 *   type       'number' | 'integer' | 'string' | 'date' | 'boolean'
 *   min / max  数值范围
 *   minLength / maxLength  字符串长度
 *   enum       允许的枚举值数组
 *   nullable   空字符串是否视为未填写（默认 true）
 */
function validate(rules) {
  return (req, res, next) => {
    const errors = [];
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      req.body = {};
    }

    for (const [field, rule] of Object.entries(rules)) {
      const label = rule.label || field;
      const value = req.body[field];

      // 未提供
      if (value === undefined) {
        if (rule.required) errors.push(`${label}不能为空`);
        continue;
      }

      // 空值
      if (value === null || value === '') {
        if (rule.required) {
          errors.push(`${label}不能为空`);
          continue;
        }
        req.body[field] = null;
        continue;
      }

      // 数值
      if (rule.type === 'number' || rule.type === 'integer') {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          errors.push(`${label}必须是数字`);
          continue;
        }
        if (rule.type === 'integer' && !Number.isInteger(num)) {
          errors.push(`${label}必须是整数`);
          continue;
        }
        if (rule.min !== undefined && num < rule.min) errors.push(`${label}不能小于${rule.min}`);
        if (rule.max !== undefined && num > rule.max) errors.push(`${label}不能大于${rule.max}`);
        req.body[field] = num;
        continue;
      }

      // 日期
      if (rule.type === 'date') {
        const str = String(value).trim();
        if (!isRealDate(str)) {
          errors.push(`${label}必须是有效日期（YYYY-MM-DD）`);
          continue;
        }
        req.body[field] = str;
        continue;
      }

      // 布尔：只接受 true/false 与 1/0，字符串同样显式转换
      if (rule.type === 'boolean') {
        if (value === true || value === 1 || value === '1') {
          req.body[field] = true;
        } else if (value === false || value === 0 || value === '0') {
          req.body[field] = false;
        } else {
          errors.push(`${label}只能是 true/false 或 1/0`);
        }
        continue;
      }

      // 字符串
      if (rule.type === 'string' || rule.type === undefined) {
        const str = String(value).trim();
        if (rule.required && str === '') {
          errors.push(`${label}不能为空`);
          continue;
        }
        if (rule.minLength && str.length < rule.minLength) {
          errors.push(`${label}至少${rule.minLength}个字符`);
        }
        if (rule.maxLength && str.length > rule.maxLength) {
          errors.push(`${label}长度不能超过${rule.maxLength}个字符`);
        }
        req.body[field] = str;
      }

      // 枚举：与规范化后的值比较（字符串已 trim、数字已转 Number），
      // 否则 " M " 这类带空白的输入会因为比较原始值而被误判非法
      if (rule.enum && !rule.enum.includes(req.body[field])) {
        errors.push(`${label}只能是：${rule.enum.join(' / ')}`);
      }
    }

    if (errors.length > 0) {
      return fail(res, 400, 400, errors.slice(0, 3).join('；'));
    }
    next();
  };
}

module.exports = { validate, isRealDate };
