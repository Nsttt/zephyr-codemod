import { describe, it, expect, beforeEach } from "@rstest/core";
import { parseFile, writeFile, hasZephyrPlugin } from "../transformers.js";
import {
  addToComposePlugins,
  addToPluginsArray,
  addToVitePlugins,
  addToVitePluginsInFunction,
  addToRollupArrayConfig,
  wrapExportDefault,
  wrapExportedFunction,
  addZephyrRSbuildPlugin,
} from "../transformers.js";
import { parse } from "@babel/parser";
import generate from "@babel/generator";
import fs from "fs";
import path from "path";
import os from "os";

describe("Zephyr Codemod Transformers", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zephyr-test-"));
  });

  describe("hasZephyrPlugin", () => {
    it("should detect withZephyr call expression", () => {
      const code = `
        import { withZephyr } from 'vite-plugin-zephyr';
        export default withZephyr()({
          plugins: []
        });
      `;
      const ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript"],
      });
      expect(hasZephyrPlugin(ast)).toBe(true);
    });

    it("should return false when withZephyr is not present", () => {
      const code = `
        export default {
          plugins: []
        };
      `;
      const ast = parse(code, { sourceType: "module" });
      expect(hasZephyrPlugin(ast)).toBe(false);
    });
  });

  describe("addToComposePlugins", () => {
    it("should add withZephyr to composePlugins call", () => {
      const code = `
        import { composePlugins, withNx } from '@nx/webpack';
        import { withReact } from '@nx/react';
        
        export default composePlugins(
          withNx(),
          withReact(),
          (config) => config
        );
      `;

      const ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript"],
      });
      addToComposePlugins(ast);
      const result = generate(ast).code;

      expect(result).toContain("withZephyr()");
      expect(result).toMatch(
        /composePlugins\s*\(\s*withNx\(\),\s*withReact\(\),\s*withZephyr\(\)/
      );
    });
  });

  describe("addToPluginsArray", () => {
    it("should add withZephyr to plugins array", () => {
      const code = `
        export default {
          plugins: [
            somePlugin(),
            anotherPlugin()
          ]
        };
      `;

      const ast = parse(code, { sourceType: "module" });
      addToPluginsArray(ast);
      const result = generate(ast).code;

      expect(result).toContain("withZephyr()");
      expect(result).toMatch(
        /plugins:\s*\[\s*somePlugin\(\),\s*anotherPlugin\(\),\s*withZephyr\(\)\s*\]/
      );
    });
  });

  describe("addToVitePlugins", () => {
    it("should add withZephyr to Vite defineConfig", () => {
      const code = `
        import { defineConfig } from 'vite';
        
        export default defineConfig({
          plugins: [react()]
        });
      `;

      const ast = parse(code, { sourceType: "module" });
      addToVitePlugins(ast);
      const result = generate(ast).code;

      expect(result).toContain("withZephyr()");
      expect(result).toMatch(
        /plugins:\s*\[\s*react\(\),\s*withZephyr\(\)\s*\]/
      );
    });
  });

  describe("addToVitePluginsInFunction", () => {
    it("should add withZephyr to Vite config with function wrapper", () => {
      const code = `
        import { defineConfig } from 'vite';
        
        export default defineConfig(() => ({
          plugins: [angular()]
        }));
      `;

      const ast = parse(code, { sourceType: "module" });
      addToVitePluginsInFunction(ast);
      const result = generate(ast).code;

      expect(result).toContain("withZephyr()");
      expect(result).toMatch(
        /plugins:\s*\[\s*angular\(\),\s*withZephyr\(\)\s*\]/
      );
    });
  });

  describe("addToRollupArrayConfig", () => {
    it("should add withZephyr to Rollup array config", () => {
      const code = `
        export default [{
          input: 'src/index.ts',
          plugins: [
            resolve(),
            babel()
          ]
        }];
      `;

      const ast = parse(code, { sourceType: "module" });
      addToRollupArrayConfig(ast);
      const result = generate(ast).code;

      expect(result).toContain("withZephyr()");
      expect(result).toMatch(
        /plugins:\s*\[\s*resolve\(\),\s*babel\(\),\s*withZephyr\(\)\s*\]/
      );
    });
  });

  describe("wrapExportDefault", () => {
    it("should wrap export default object with withZephyr", () => {
      const code = `
        export default {
          mode: 'development',
          entry: './src/index.js'
        };
      `;

      const ast = parse(code, { sourceType: "module" });
      wrapExportDefault(ast);
      const result = generate(ast).code;

      expect(result).toContain("withZephyr()");
      expect(result).toMatch(/export default withZephyr\(\)\(\{[\s\S]*\}\);/);
    });
  });

  describe("wrapExportedFunction", () => {
    it("should wrap exported function with withZephyr for Re.Pack", () => {
      const code = `
        const config = env => {
          const {mode, platform} = env;
          return {
            mode,
            entry: './index.js'
          };
        };
        
        export default config;
      `;

      const ast = parse(code, { sourceType: "module" });
      wrapExportedFunction(ast);
      const result = generate(ast).code;

      expect(result).toContain("withZephyr()");
      expect(result).toMatch(/export default withZephyr\(\)\(config\);/);
    });

    it("should skip conditional exports that already have withZephyr", () => {
      const code = `
        const config = env => ({ mode: 'development' });
        export default USE_ZEPHYR ? withZephyr()(config) : config;
      `;

      const ast = parse(code, { sourceType: "module" });
      wrapExportedFunction(ast);
      const result = generate(ast).code;

      // Should not modify the conditional expression
      expect(result).toContain("USE_ZEPHYR ? withZephyr()(config) : config");
      expect(result.split("withZephyr").length).toBe(2); // Only one occurrence
    });
  });

  describe("addZephyrRSbuildPlugin", () => {
    it("should add Zephyr RSBuild plugin function and call to defineConfig", () => {
      const code = `
        import { defineConfig } from '@rsbuild/core';
        import { pluginReact } from '@rsbuild/plugin-react';
        
        export default defineConfig({
          plugins: [pluginReact()]
        });
      `;

      const ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript"],
      });
      addZephyrRSbuildPlugin(ast);
      const result = generate(ast).code;

      expect(result).toContain("zephyrRSbuildPlugin");
      expect(result).toContain("RsbuildPlugin");
      expect(result).toContain("zephyr-rsbuild-plugin");
      expect(result).toContain("api.modifyRspackConfig");
      expect(result).toMatch(
        /plugins:\s*\[\s*pluginReact\(\),\s*zephyrRSbuildPlugin\(\)\s*\]/
      );
    });

    it("should not duplicate zephyrRSbuildPlugin if already exists", () => {
      const code = `
        import { defineConfig, RsbuildPlugin } from '@rsbuild/core';
        import { withZephyr } from 'zephyr-rspack-plugin';
        
        const zephyrRSbuildPlugin = (): RsbuildPlugin => ({
          name: 'zephyr-rsbuild-plugin',
          setup(api) {
            api.modifyRspackConfig(async (config) => {
              const zephyrConfig = await withZephyr()(config);
              config = zephyrConfig;
            });
          },
        });
        
        export default defineConfig({
          plugins: [zephyrRSbuildPlugin()]
        });
      `;

      const ast = parse(code, {
        sourceType: "module",
        plugins: ["typescript"],
      });
      addZephyrRSbuildPlugin(ast);
      const result = generate(ast).code;

      // Should not duplicate the plugin function or call
      const pluginOccurrences = (result.match(/zephyrRSbuildPlugin/g) || [])
        .length;
      expect(pluginOccurrences).toBe(2); // Function name and call (function already exists)
    });
  });

  describe("Integration Tests", () => {
    it("should handle webpack config with composePlugins", () => {
      const configPath = path.join(tempDir, "webpack.config.ts");
      const code = `
        import { composePlugins, withNx } from '@nx/webpack';
        import { withReact } from '@nx/react';
        import { withModuleFederation } from '@nx/react/module-federation';
        
        export default composePlugins(
          withNx(),
          withReact(),
          withModuleFederation(config),
          (config) => config
        );
      `;

      fs.writeFileSync(configPath, code);
      const ast = parseFile(configPath);
      addToComposePlugins(ast);
      writeFile(configPath, ast);

      const result = fs.readFileSync(configPath, "utf8");
      expect(result).toContain("withZephyr()");
      expect(result).toMatch(
        /withModuleFederation\(config\),\s*withZephyr\(\),/
      );
    });

    it("should handle Vite config with complex setup", () => {
      const configPath = path.join(tempDir, "vite.config.ts");
      const code = `
        import { defineConfig } from 'vite';
        import react from '@vitejs/plugin-react';
        import { resolve } from 'path';
        
        export default defineConfig({
          plugins: [react()],
          resolve: {
            alias: {
              '@': resolve(__dirname, 'src')
            }
          },
          server: {
            port: 3000
          }
        });
      `;

      fs.writeFileSync(configPath, code);
      const ast = parseFile(configPath);
      addToVitePlugins(ast);
      writeFile(configPath, ast);

      const result = fs.readFileSync(configPath, "utf8");
      expect(result).toContain("withZephyr()");
      expect(result).toContain("react(), withZephyr()");
    });

    it("should handle RSBuild config transformation end-to-end", () => {
      const configPath = path.join(tempDir, "rsbuild.config.ts");
      const code = `
        import { defineConfig } from '@rsbuild/core';
        import { pluginReact } from '@rsbuild/plugin-react';
        import { pluginSass } from '@rsbuild/plugin-sass';
        
        export default defineConfig({
          plugins: [pluginReact(), pluginSass()],
          html: {
            template: './public/index.html'
          }
        });
      `;

      fs.writeFileSync(configPath, code);
      const ast = parseFile(configPath);
      addZephyrRSbuildPlugin(ast);
      writeFile(configPath, ast);

      const result = fs.readFileSync(configPath, "utf8");
      expect(result).toContain("import { withZephyr }");
      expect(result).toContain("RsbuildPlugin");
      expect(result).toContain("zephyrRSbuildPlugin()");
      expect(result).toMatch(
        /plugins:\s*\[\s*pluginReact\(\),\s*pluginSass\(\),\s*zephyrRSbuildPlugin\(\)\s*\]/
      );
    });
  });
});
