export interface Config {
  linearApiKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const linearApiKey = env.LINEAR_API_KEY;
  if (!linearApiKey) {
    throw new Error("LINEAR_API_KEY environment variable is required.");
  }
  return { linearApiKey };
}
