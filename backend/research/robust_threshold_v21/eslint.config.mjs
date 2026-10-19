export default [{ files:['**/*.mjs'], ignores:['**/bundles/**'], languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{
  process:'readonly',console:'readonly',Buffer:'readonly',URL:'readonly',structuredClone:'readonly'}},
rules:{'no-unused-vars':'error','no-undef':'error'} }];
