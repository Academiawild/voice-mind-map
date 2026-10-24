import 'dotenv/config';
import { z } from 'zod';

const BooleanStringSchema = z.union([z.boolean(), z.string()]).transform((value, context) => {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) {
    return false;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Invalid boolean value: ${value}`,
  });
  return z.NEVER;
});

const defaultFunAsrPython = 'dependencies/local/asr-venv/bin/python';
const LocalAIBaseUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
    );
  }, 'LOCAL_AI_BASE_URL must use a loopback HTTP address.');

const EnvSchema = z.object({
  DEBUG_MINDMAP: BooleanStringSchema.default(false),
  FUNASR_HTTP_PORT: z.coerce.number().int().positive().default(10096),
  FUNASR_MODEL: z.string().default('paraformer-zh'),
  FUNASR_PUNC_MODEL: z.string().default('ct-punc'),
  FUNASR_PYTHON: z.string().optional(),
  FUNASR_VAD_MODEL: z.string().default('fsmn-vad'),
  FUNASR_WS_PORT: z.coerce.number().int().positive().default(10095),
  LOCAL_AI_BASE_URL: LocalAIBaseUrlSchema.default('http://127.0.0.1:11434'),
  LOCAL_AI_CONTEXT: z.coerce.number().int().min(4096).max(131072).default(16384),
  LOCAL_AI_MODEL: z.string().trim().min(1).default('qwen-q4kp'),
  LOCAL_SHUTDOWN_TOKEN: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(8787),
  RUNTIME_ID: z.string().optional(),
  VITE_PORT: z.coerce.number().int().positive().default(5173),
});

export type AppEnv = {
  provider: 'ollama';
  host: '127.0.0.1';
  port: number;
  frontendPort: number;
  debugMindMap: boolean;
  funasrHttpPort: number;
  funasrModel: string;
  funasrPuncModel: string;
  funasrPython: string;
  funasrVadModel: string;
  funasrWsPort: number;
  localAiBaseUrl: string;
  localAiContext: number;
  localAiModel: string;
  localShutdownToken?: string;
  runtimeId: string;
};

function firstNonBlank(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim());
}

export function loadEnv(): AppEnv {
  const parsed = EnvSchema.parse({
    ...process.env,
  });

  const env: AppEnv = {
    provider: 'ollama',
    host: '127.0.0.1',
    port: parsed.PORT,
    frontendPort: parsed.VITE_PORT,
    debugMindMap: parsed.DEBUG_MINDMAP,
    funasrHttpPort: parsed.FUNASR_HTTP_PORT,
    funasrModel: parsed.FUNASR_MODEL,
    funasrPuncModel: parsed.FUNASR_PUNC_MODEL,
    funasrPython: firstNonBlank(parsed.FUNASR_PYTHON) ?? defaultFunAsrPython,
    funasrVadModel: parsed.FUNASR_VAD_MODEL,
    funasrWsPort: parsed.FUNASR_WS_PORT,
    localAiBaseUrl: parsed.LOCAL_AI_BASE_URL,
    localAiContext: parsed.LOCAL_AI_CONTEXT,
    localAiModel: parsed.LOCAL_AI_MODEL,
    localShutdownToken: parsed.LOCAL_SHUTDOWN_TOKEN,
    runtimeId: firstNonBlank(parsed.RUNTIME_ID) ?? `local-${process.pid}`,
  };

  return env;
}
