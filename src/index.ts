#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { glob } from "glob";
import { program } from "commander";
import chalk from "chalk";

import { BUNDLER_CONFIGS } from "./bundler-configs.js";
import {
  parseFile,
  writeFile,
  addZephyrImport,
  addZephyrRequire,
  hasZephyrPlugin,
  addToComposePlugins,
  addToPluginsArray,
  addToVitePlugins,
  addToVitePluginsInFunction,
  addToRollupFunction,
  addToRollupArrayConfig,
  addToRolldownPlugins,
  addToModernJSPlugins,
  addToRSPressPlugins,
  addToParcelReporters,
  wrapModuleExports,
  wrapExportDefault,
  skipAlreadyWrapped,
  wrapExportedFunction,
  addZephyrRSbuildPlugin,
} from "./transformers.js";
import {
  detectPackageManager,
  isPackageInstalled,
  installPackage,
} from "./package-manager.js";
import type {
  ConfigFile,
  CodemodOptions,
  TransformFunctions,
  BundlerPattern,
  BundlerConfig,
} from "./types.js";

// Map transform names to functions
const TRANSFORMERS: TransformFunctions = {
  addToComposePlugins,
  addToPluginsArray,
  addToVitePlugins,
  addToVitePluginsInFunction,
  addToRollupFunction,
  addToRollupArrayConfig,
  addToRolldownPlugins,
  addToModernJSPlugins,
  addToRSPressPlugins,
  wrapModuleExports,
  wrapExportDefault,
  skipAlreadyWrapped,
  wrapExportedFunction,
  addZephyrRSbuildPlugin,
};

/**
 * Find all bundler configuration files in the given directory
 */
function findConfigFiles(directory: string): ConfigFile[] {
  const configFiles: ConfigFile[] = [];

  for (const [bundlerName, config] of Object.entries(BUNDLER_CONFIGS)) {
    for (const fileName of config.files) {
      const pattern = path.join(directory, "**", fileName);
      const matches = glob.sync(pattern, { ignore: ["**/node_modules/**"] });

      for (const filePath of matches) {
        configFiles.push({
          filePath,
          bundlerName,
          config,
        });
      }
    }
  }

  return configFiles;
}

/**
 * Check if a configuration file already has withZephyr
 */
function checkHasZephyr(filePath: string, config: BundlerConfig): boolean {
  try {
    if (config.plugin === "parcel-reporter-zephyr") {
      const content = fs.readFileSync(filePath, "utf8");
      const parcelConfig = JSON.parse(content);
      return (
        parcelConfig.reporters && parcelConfig.reporters.includes(config.plugin)
      );
    } else {
      const ast = parseFile(filePath);
      return hasZephyrPlugin(ast);
    }
  } catch (error) {
    console.warn(
      chalk.yellow(
        `Warning: Could not parse ${filePath}: ${(error as Error).message}`
      )
    );
    return false;
  }
}

/**
 * Determine the appropriate transformation pattern for a config file
 */
function detectPattern(
  filePath: string,
  config: BundlerConfig
): BundlerPattern | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");

    for (const pattern of config.patterns) {
      if (pattern.matcher.test(content)) {
        return pattern;
      }
    }

    // Default to the first pattern if none match
    return config.patterns[0] || null;
  } catch (error) {
    console.warn(
      chalk.yellow(
        `Warning: Could not read ${filePath}: ${(error as Error).message}`
      )
    );
    return config.patterns[0] || null;
  }
}

/**
 * Transform a configuration file to add withZephyr
 */
function transformConfigFile(
  filePath: string,
  bundlerName: string,
  config: BundlerConfig,
  options: { dryRun?: boolean } = {}
): boolean {
  const { dryRun = false } = options;

  try {
    console.log(chalk.blue(`Processing ${bundlerName} config: ${filePath}`));

    // Special handling for Parcel JSON configs
    if (config.plugin === "parcel-reporter-zephyr") {
      if (!dryRun) {
        addToParcelReporters(filePath, config.plugin);
      }
      console.log(chalk.green(`✓ Added ${config.plugin} to ${filePath}`));
      return true;
    }

    // Parse JavaScript/TypeScript config files
    const ast = parseFile(filePath);
    const pattern = detectPattern(filePath, config);

    if (!pattern) {
      console.warn(
        chalk.yellow(`Warning: No suitable pattern found for ${filePath}`)
      );
      return false;
    }

    // Add import/require statement
    const fileContent = fs.readFileSync(filePath, "utf8");
    const hasESMSyntax =
      fileContent.includes("import ") || fileContent.includes("export ");
    const isCommonJS = filePath.endsWith(".js") && !hasESMSyntax;

    if (isCommonJS) {
      addZephyrRequire(ast, config.plugin, config.importName);
    } else {
      addZephyrImport(ast, config.plugin, config.importName);
    }

    // Apply transformation
    const transformer = TRANSFORMERS[pattern.transform];
    if (transformer) {
      transformer(ast);
    } else {
      console.warn(
        chalk.yellow(`Warning: Unknown transformer ${pattern.transform}`)
      );
      return false;
    }

    if (!dryRun) {
      writeFile(filePath, ast);
    }

    console.log(chalk.green(`✓ Added withZephyr to ${filePath}`));
    return true;
  } catch (error) {
    console.error(
      chalk.red(`Error transforming ${filePath}: ${(error as Error).message}`)
    );
    return false;
  }
}

/**
 * Main codemod function
 */
function runCodemod(directory: string, options: CodemodOptions = {}): void {
  const { dryRun = false, bundlers = null, installPackages = false } = options;

  console.log(
    chalk.bold(`🚀 Zephyr Codemod - Adding withZephyr to bundler configs`)
  );
  console.log(chalk.gray(`Directory: ${path.resolve(directory)}`));

  if (dryRun) {
    console.log(chalk.yellow(`🔍 Dry run mode - no files will be modified\n`));
  }

  const configFiles = findConfigFiles(directory);

  if (configFiles.length === 0) {
    console.log(chalk.yellow("No bundler configuration files found."));
    return;
  }

  // Collect unique plugins that need to be installed
  const requiredPlugins = new Set<string>();
  const packagesToProcess: ConfigFile[] = [];
  const filteredConfigFiles: ConfigFile[] = [];

  for (const { filePath, bundlerName, config } of configFiles) {
    // Filter by specific bundlers if requested
    if (bundlers && !bundlers.includes(bundlerName)) {
      continue;
    }

    filteredConfigFiles.push({ filePath, bundlerName, config });

    // Check if already has withZephyr
    if (checkHasZephyr(filePath, config)) {
      console.log(
        chalk.gray(`⏭️  Skipping ${filePath} (already has withZephyr)`)
      );
      continue;
    }

    requiredPlugins.add(config.plugin);
    packagesToProcess.push({ filePath, bundlerName, config });
  }

  console.log(
    chalk.blue(`Found ${filteredConfigFiles.length} configuration file(s):\n`)
  );

  // Check and install missing packages
  if (installPackages && requiredPlugins.size > 0 && !dryRun) {
    console.log(chalk.blue(`\n📦 Checking package dependencies...\n`));

    const packageManager = detectPackageManager(directory);
    console.log(chalk.gray(`Detected package manager: ${packageManager}`));

    for (const pluginName of requiredPlugins) {
      if (!isPackageInstalled(pluginName, directory)) {
        console.log(chalk.yellow(`Installing ${pluginName}...`));

        const success = installPackage(
          directory,
          pluginName,
          packageManager,
          true
        );
        if (success) {
          console.log(chalk.green(`✓ Installed ${pluginName}`));
        } else {
          console.log(chalk.red(`✗ Failed to install ${pluginName}`));
        }
      } else {
        console.log(chalk.gray(`✓ ${pluginName} already installed`));
      }
    }
    console.log();
  } else if (installPackages && requiredPlugins.size > 0 && dryRun) {
    console.log(chalk.blue(`\n📦 Packages that would be installed:\n`));
    for (const pluginName of requiredPlugins) {
      if (!isPackageInstalled(pluginName, directory)) {
        console.log(chalk.yellow(`  - ${pluginName}`));
      }
    }
    console.log();
  }

  // Process configuration files
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const { filePath, bundlerName, config } of packagesToProcess) {
    const success = transformConfigFile(filePath, bundlerName, config, {
      dryRun,
    });
    if (success) {
      processed++;
    } else {
      errors++;
    }
  }

  console.log(`\n${chalk.bold("Summary:")}`);
  console.log(`${chalk.green("✓")} Processed: ${processed}`);
  console.log(
    `${chalk.gray("⏭️")} Skipped: ${
      filteredConfigFiles.length - packagesToProcess.length
    }`
  );
  console.log(`${chalk.red("✗")} Errors: ${errors}`);

  if (dryRun && processed > 0) {
    console.log(chalk.yellow(`\nRun without --dry-run to apply changes.`));
  }

  if (!installPackages && requiredPlugins.size > 0) {
    console.log(
      chalk.blue(
        `\n💡 Tip: Use --install to automatically install missing packages:`
      )
    );
    for (const pluginName of requiredPlugins) {
      if (!isPackageInstalled(pluginName, directory)) {
        console.log(chalk.gray(`  ${pluginName}`));
      }
    }
  }
}

// CLI setup
program
  .name("zephyr-codemod")
  .description("Automatically add withZephyr plugin to bundler configurations")
  .version("1.0.0")
  .argument("[directory]", "Directory to search for config files", ".")
  .option("-d, --dry-run", "Show what would be changed without modifying files")
  .option(
    "-b, --bundlers <bundlers...>",
    "Only process specific bundlers (webpack, vite, rollup, etc.)"
  )
  .option("-i, --install", "Automatically install missing plugin packages")
  .action((directory: string, options: any) => {
    runCodemod(directory, { ...options, installPackages: options.install });
  });

// Show help if no arguments provided
if (process.argv.length === 2) {
  program.help();
}

program.parse();

export { runCodemod, findConfigFiles, transformConfigFile };
