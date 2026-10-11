/**
 * 解析正则格式的关键词：/pattern/flags 或 regex:pattern
 */
export function parseRegexKeyword(keyword: string): { isRegex: boolean; pattern?: string; flags?: string } {
  if (!keyword || keyword.trim().length === 0) {
    return { isRegex: false };
  }

  // 检测 /pattern/flags 格式（如 /pattern/i, /pattern/gi 等）
  if (keyword.startsWith('/')) {
    const lastSlashIndex = keyword.lastIndexOf('/');
    if (lastSlashIndex > 0) {
      const pattern = keyword.slice(1, lastSlashIndex);
      const flags = keyword.slice(lastSlashIndex + 1);
      return { isRegex: true, pattern, flags };
    }
  }

  // 检测 regex: 前缀格式
  if (keyword.toLowerCase().startsWith('regex:')) {
    return { isRegex: true, pattern: keyword.slice(6), flags: 'i' };
  }

  return { isRegex: false };
}

/**
 * 校验关键词：正则格式的关键词必须能编译，普通关键词总是有效
 */
export function isValidKeyword(keyword: string | undefined): boolean {
  if (!keyword) return true;
  const regexInfo = parseRegexKeyword(keyword);
  if (!regexInfo.isRegex || !regexInfo.pattern) return true;
  try {
    new RegExp(regexInfo.pattern, regexInfo.flags || 'i');
    return true;
  } catch {
    return false;
  }
}
