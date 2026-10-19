import parser from '../../../apps/customer-web/node_modules/@typescript-eslint/parser/dist/index.js';
import plugin from '../../../apps/customer-web/node_modules/@typescript-eslint/eslint-plugin/dist/index.js';
export default [{files:['**/*.mjs'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{process:'readonly',console:'readonly',Buffer:'readonly',URL:'readonly',window:'readonly',navigator:'readonly',setTimeout:'readonly',clearTimeout:'readonly'}},
  rules:{'no-unused-vars':'error','no-undef':'error'}},
  {files:['**/*.ts'],languageOptions:{parser,ecmaVersion:'latest',sourceType:'module'},plugins:{'@typescript-eslint':plugin},
    rules:{'@typescript-eslint/no-unused-vars':'error','no-debugger':'error'}}];
