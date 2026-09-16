export type { AddOptions, AddResult } from "./add.js";
export { addNola } from "./add.js";
export type { AgentId, AgentSetupResult } from "./agents.js";
export { AGENT_IDS, AGENT_OPTIONS, defaultAgents, parseAgentsFlag, writeAgentSkills } from "./agents.js";
export type {
  ClientInit,
  KeyGrant,
  NolaAccountKind,
  NolaAuthConfig,
  NolaBillingSession,
  NolaCapabilities,
  NolaClaim,
  NolaConsoleCreatedKey,
  NolaConsoleMe,
  NolaTrialResponse,
} from "./api.js";
export {
  claimSession,
  createBillingSession,
  createConsoleKey,
  DEFAULT_API_URL,
  fetchCapabilities,
  fetchMe,
  isSessionRejected,
  NolaApiError,
  nolaApiUrl,
  requestTrial,
  sessionIdOf,
} from "./api.js";
export type { AuthOptions, SignInOptions, TokenSet } from "./auth.js";
export {
  ACCOUNT_CLAIM,
  ACCOUNT_PARAM,
  accessTokenFor,
  accountIdOfToken,
  authConfig,
  authorizeUrl,
  pkcePair,
  SIGN_IN_TIMEOUT_MS,
  SignInError,
  SignInUnavailableError,
  signIn,
  signOut,
} from "./auth.js";
export type { CliIo, CliMeta, CommandContext, CommandSpec, OptionSpec } from "./cli.js";
export { defineCommand, dispatch, renderCommandHelp, renderHelp } from "./cli.js";
export type { Session } from "./credentials.js";
export { CREDENTIALS_FILE, credentialsPath, deleteSession, readSession, writeSession } from "./credentials.js";
export { collectExampleFromDisk, devExamplesDir, rewriteExamplePackageJson } from "./examples.js";
export type { FlowInput, FlowOutcome, KeyPath, Prompter, PrompterOption, RunFlowArgs, RunFlowOptions } from "./flow.js";
export { CREATE_COMMAND, FLOW_OPTIONS, nolaHint, PROVIDER_QUESTION, plainPrompter, providerOptions, resolveScaffoldOptions, runFlow, SIGN_IN_QUESTION } from "./flow.js";
export type { FetchLike } from "./github.js";
export { ExampleFetchError, fetchExampleFromGitHub } from "./github.js";
export type { NolaHomeConfig, TrialAccountRecord } from "./home-config.js";
export { HOME_CONFIG_FILE, homeConfigPath, readHomeConfig, recordTrialAccount } from "./home-config.js";
export type { IdeSetupResult } from "./ide.js";
export { writeVscodeSetup } from "./ide.js";
export type { AcquireKeyOptions } from "./key.js";
export { acquireKey, claimNote, claimProjectKey, SignInRequiredError } from "./key.js";
export { openBrowser, openUrl, openWith, type Spawn } from "./open-url.js";
export type { Palette } from "./palette.js";
export { ansi, paletteFrom, plain, tagPalette } from "./palette.js";
export { clackPrompter } from "./prompter.js";
export type { ProviderDef, ProviderId } from "./providers.js";
export { isProviderId, PROVIDERS, providerById, providerIds } from "./providers.js";
export type { TemplateDef } from "./registry.js";
export { TEMPLATES, templateByName, templateNames } from "./registry.js";
export type { ScaffoldOptions, ScaffoldResult } from "./scaffold.js";
export { ownVersion, providerConfigUrl, scaffold } from "./scaffold.js";
export type { SkillInstallArgs, SkillInstallOptions } from "./skill-install.js";
export { runSkillInstall } from "./skill-install.js";
export type { TrialApplyResult } from "./trial.js";
export { applyTrial, ENV_KEY, ensureEnvIgnored, hasEnvKey, readEnvKey, TRIAL_CONFIG_URL, writeEnvKey } from "./trial.js";
