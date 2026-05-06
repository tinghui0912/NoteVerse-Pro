/**
 * 翻译文件拆分脚本
 * 
 * 将 translations.ts 的扁平 key 拆分为按命名空间组织的 JSON 文件。
 * 输出: messages/{zh,en}/*.json
 */

const fs = require('fs');
const path = require('path');

// 命名空间映射规则
const NAMESPACE_MAP = {
  'nav.': 'common',        // nav 合并到 common，作为嵌套对象
  'common.': 'common',
  'home.': 'home',
  'auth.': 'auth',
  'validation.': 'auth',   // validation 合并到 auth
  'upload.': 'upload',
  'review.': 'review',
  'editor.': 'editor',
  'results.': 'results',
  'history.': 'history',
  'share.': 'share',
  'profile.': 'profile',
  'practice.': 'practice',
  'pricing.': 'pricing',
  'help.': 'help',
  'status.': 'backend',    // status 归入 backend
  'step.': 'backend',      // step 归入 backend
};

// 读取 translations.ts 并提取翻译对象
function parseTranslations(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  const result = { zh: {}, en: {} };
  
  for (const lang of ['zh', 'en']) {
    // 找到 lang 块的起始位置
    const langRegex = new RegExp(`${lang}:\\s*\\{`);
    const langMatch = content.match(langRegex);
    if (!langMatch) {
      console.error(`Could not find ${lang} block`);
      continue;
    }
    
    const startIdx = content.indexOf(langMatch[0]) + langMatch[0].length;
    
    // 找到对应的闭合 }
    let braceCount = 1;
    let endIdx = startIdx;
    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') braceCount--;
      if (braceCount === 0) {
        endIdx = i;
        break;
      }
    }
    
    const block = content.substring(startIdx, endIdx);
    
    // 提取所有 key-value 对
    const kvRegex = /'([^']+)':\s*'((?:[^'\\]|\\.)*)'/g;
    let match;
    while ((match = kvRegex.exec(block)) !== null) {
      const key = match[1];
      const value = match[2].replace(/\\'/g, "'");
      result[lang][key] = value;
    }
  }
  
  return result;
}

// 确定 key 属于哪个命名空间
function getNamespace(key) {
  for (const [prefix, ns] of Object.entries(NAMESPACE_MAP)) {
    if (key.startsWith(prefix)) {
      return ns;
    }
  }
  // 没有前缀的 key (如 'task_not_found', 'unauthorized') 归入 backend
  return 'backend';
}

// 将扁平 key 转换为目标 JSON 结构
function getTargetKey(key, namespace) {
  // 对于合并到其他命名空间的前缀，保留前缀作为嵌套
  // 例如: 'nav.home' 在 common.json 中变为 nav.home 嵌套
  // 'common.cancel' 在 common.json 中变为 cancel
  
  for (const [prefix, ns] of Object.entries(NAMESPACE_MAP)) {
    if (key.startsWith(prefix) && ns === namespace) {
      const subKey = key.substring(prefix.length);
      const nsPrefix = prefix.replace('.', '');
      
      // 如果命名空间就是 key 自身的前缀，去掉前缀
      if (nsPrefix === namespace) {
        return { nested: false, key: subKey };
      }
      // 否则保留前缀作为嵌套对象
      return { nested: true, parent: nsPrefix, key: subKey };
    }
  }
  
  // backend 中无前缀的 key，直接使用
  return { nested: false, key: key };
}

// 设置嵌套对象的值
function setNestedValue(obj, targetKey, value) {
  if (targetKey.nested) {
    if (!obj[targetKey.parent]) {
      obj[targetKey.parent] = {};
    }
    obj[targetKey.parent][targetKey.key] = value;
  } else {
    obj[targetKey.key] = value;
  }
}

// 主函数
function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const translationsPath = path.join(projectRoot, 'src', 'lib', 'translations.ts');
  const messagesDir = path.join(projectRoot, 'messages');
  
  console.log('📖 解析 translations.ts...');
  const translations = parseTranslations(translationsPath);
  
  const zhKeys = Object.keys(translations.zh);
  const enKeys = Object.keys(translations.en);
  console.log(`   zh: ${zhKeys.length} 个 key`);
  console.log(`   en: ${enKeys.length} 个 key`);
  
  // 按命名空间分组
  const namespaces = {};
  
  for (const lang of ['zh', 'en']) {
    namespaces[lang] = {};
    
    for (const [key, value] of Object.entries(translations[lang])) {
      const ns = getNamespace(key);
      if (!namespaces[lang][ns]) {
        namespaces[lang][ns] = {};
      }
      
      const targetKey = getTargetKey(key, ns);
      setNestedValue(namespaces[lang][ns], targetKey, value);
    }
  }
  
  // 写入 JSON 文件
  console.log('\n📁 生成 JSON 文件...');
  
  const allNamespaces = new Set([
    ...Object.keys(namespaces.zh),
    ...Object.keys(namespaces.en),
  ]);
  
  let totalFiles = 0;
  for (const ns of allNamespaces) {
    for (const lang of ['zh', 'en']) {
      const dir = path.join(messagesDir, lang);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const data = namespaces[lang][ns] || {};
      const filePath = path.join(dir, `${ns}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      
      const keyCount = countKeys(data);
      console.log(`   ✅ ${lang}/${ns}.json (${keyCount} keys)`);
      totalFiles++;
    }
  }
  
  console.log(`\n🎉 完成！共生成 ${totalFiles} 个文件`);
  
  // 验证 zh/en key 一致性
  console.log('\n🔍 验证 key 一致性...');
  let mismatches = 0;
  for (const ns of allNamespaces) {
    const zhKeysInNs = getKeyPaths(namespaces.zh[ns] || {});
    const enKeysInNs = getKeyPaths(namespaces.en[ns] || {});
    
    const zhOnly = zhKeysInNs.filter(k => !enKeysInNs.includes(k));
    const enOnly = enKeysInNs.filter(k => !zhKeysInNs.includes(k));
    
    if (zhOnly.length > 0) {
      console.log(`   ⚠️  ${ns}: zh 独有 key: ${zhOnly.join(', ')}`);
      mismatches += zhOnly.length;
    }
    if (enOnly.length > 0) {
      console.log(`   ⚠️  ${ns}: en 独有 key: ${enOnly.join(', ')}`);
      mismatches += enOnly.length;
    }
  }
  
  if (mismatches === 0) {
    console.log('   ✅ 所有命名空间 key 完全一致');
  } else {
    console.log(`   ⚠️  发现 ${mismatches} 个不一致的 key`);
  }
}

function countKeys(obj) {
  let count = 0;
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null) {
      count += countKeys(value);
    } else {
      count++;
    }
  }
  return count;
}

function getKeyPaths(obj, prefix = '') {
  const paths = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      paths.push(...getKeyPaths(value, fullKey));
    } else {
      paths.push(fullKey);
    }
  }
  return paths;
}

main();
