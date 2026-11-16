// 字段规范化与展示映射：性别、日期区间、CSV 单元格

// 性别统一为 M / F，未填写为 null（R13）
// 兼容历史中文值与大小写，其余一律视为非法
function normalizeGender(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  if (['M', 'm', '男', 'male', 'Male'].includes(raw)) return 'M';
  if (['F', 'f', '女', 'female', 'Female'].includes(raw)) return 'F';
  return 'INVALID';
}

function genderLabel(value) {
  if (value === 'M') return '男';
  if (value === 'F') return '女';
  return '未填写';
}

// 起止日期顺序校验：两个都为空时不校验
function dateRangeProblem(startDate, endDate) {
  if (!startDate || !endDate) return null;
  if (new Date(startDate) > new Date(endDate)) return '结束日期不能早于开始日期';
  return null;
}

// CSV 单元格：先防公式注入（= + - @ 开头、Tab / CR 开头），再做引号转义（R10）
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// 手机号/邮箱脱敏，供教师导出时使用（R19）
function maskContact(value, type) {
  if (!value) return '';
  const s = String(value);
  if (type === 'phone') {
    return s.length >= 7 ? s.slice(0, 3) + '****' + s.slice(-4) : '***';
  }
  const at = s.indexOf('@');
  if (at <= 0) return '***';
  const name = s.slice(0, at);
  const head = name.slice(0, Math.min(2, name.length));
  return head + '***' + s.slice(at);
}

module.exports = { normalizeGender, genderLabel, dateRangeProblem, csvCell, maskContact };
