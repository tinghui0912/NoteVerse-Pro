export default [{ files:['**/*.mjs'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{
  process:'readonly',console:'readonly',Buffer:'readonly',URL:'readonly',crypto:'readonly',self:'readonly',
  navigator:'readonly',performance:'readonly',window:'readonly',fetch:'readonly',Worker:'readonly',structuredClone:'readonly'}},
rules:{'no-unused-vars':'error','no-undef':'error'} }];
