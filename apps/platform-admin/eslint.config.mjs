import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: [".next/**", "node_modules/**", "generated/**"],
  },
  {
    rules: {
      "no-console": "error",
    },
  },
];

export default config;
