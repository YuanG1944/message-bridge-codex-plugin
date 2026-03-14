export function optimizeMarkdownStyle(text: string): string {
  try {
    return stripInvalidImageKeys(optimizeMarkdownBlocks(text));
  } catch {
    return text;
  }
}

function optimizeMarkdownBlocks(text: string): string {
  const mark = '___CB_';
  const codeBlocks: string[] = [];
  let result = text.replace(/```[\s\S]*?```/g, block => `${mark}${codeBlocks.push(block) - 1}___`);

  const hasH1toH3 = /^#{1,3} /m.test(text);
  if (hasH1toH3) {
    result = result.replace(/^#{2,6} (.+)$/gm, '##### $1');
    result = result.replace(/^# (.+)$/gm, '#### $1');
  }

  result = result.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gm, '$1\n<br>\n$2');
  result = result.replace(/^([^|\n].*)\n(\|.+\|)/gm, '$1\n\n$2');
  result = result.replace(/\n\n((?:\|.+\|[^\S\n]*\n?)+)/g, '\n\n<br>\n\n$1');
  result = result.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, '$1\n<br>\n');
  result = result.replace(/^((?!#{4,5} )(?!\*\*).+)\n\n(<br>)\n\n(\|)/gm, '$1\n$2\n$3');
  result = result.replace(/^(\*\*.+)\n\n(<br>)\n\n(\|)/gm, '$1\n$2\n\n$3');
  result = result.replace(/(\|[^\n]*\n)\n(<br>\n)((?!#{4,5} )(?!\*\*))/gm, '$1$2$3');

  codeBlocks.forEach((block, index) => {
    result = result.replace(`${mark}${index}___`, `\n<br>\n${block}\n<br>\n`);
  });

  return result.replace(/\n{3,}/g, '\n\n');
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

function stripInvalidImageKeys(text: string): string {
  if (!text.includes('![')) return text;
  return text.replace(IMAGE_RE, (fullMatch, _alt, value) => {
    if (value.startsWith('img_')) return fullMatch;
    if (value.startsWith('http://')) return fullMatch;
    if (value.startsWith('https://')) return fullMatch;
    return value;
  });
}
