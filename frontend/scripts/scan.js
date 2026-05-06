const fs = require('fs');
const path = require('path');
const SRC_DIR = path.join(process.cwd(), 'src');

function findChineseFiles(dir, results = []) {
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat && stat.isDirectory()) {
      findChineseFiles(fullPath, results);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      
      let inMultiLineComment = false;
      
      lines.forEach((line, index) => {
        let text = line.trim();
        
        if (inMultiLineComment) {
            if (text.includes('*/')) {
                inMultiLineComment = false;
                text = text.substring(text.indexOf('*/') + 2);
            } else {
                return;
            }
        }
        
        if (text.startsWith('/*')) {
            if (text.includes('*/')) {
                text = text.substring(text.indexOf('*/') + 2);
            } else {
                inMultiLineComment = true;
                return;
            }
        }

        // Ignore single-line comments and console.log
        if (text.startsWith('//') || text.startsWith('*') || text.includes('console.')) {
            return;
        }
        
        // Remove end-of-line comments
        const commentIdx = text.indexOf('//');
        if (commentIdx !== -1) {
            text = text.substring(0, commentIdx);
        }
        
        // Check for Chinese characters
        if (/[\u4e00-\u9fa5]/.test(text)) {
            results.push({ file: fullPath.replace(SRC_DIR, ''), line: index + 1, text: text.trim() });
        }
      });
    }
  });
  return results;
}

const results = findChineseFiles(SRC_DIR);
if(results.length === 0) {
    fs.writeFileSync('scan-results.txt', 'No hardcoded Chinese strings found!');
} else {
    const lines = results.map(res => `${res.file}:${res.line} - ${res.text}`);
    fs.writeFileSync('scan-results.txt', lines.join('\n'));
}
