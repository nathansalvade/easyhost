import { z } from 'zod';

export const CATEGORIES = ['Media', 'Files', 'Smart home', 'Network', 'Monitoring'] as const;

export function isPinnedImage(image: string): boolean {
  const lastSlash = image.lastIndexOf('/');
  const lastColon = image.lastIndexOf(':');
  if (lastColon <= lastSlash) return false;
  const tag = image.slice(lastColon + 1);
  return tag !== 'latest' && /\d/.test(tag);
}

const port = z.number().int().min(1).max(65535);
const envKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const step = z.object({ text: z.string().min(1), command: z.string().min(1).optional() }).strict();
const steps = z.array(step).min(1);

export const volumeSchema = z
  .object({ name: z.string().regex(/^[a-z0-9-]+$/), containerPath: z.string().startsWith('/') })
  .strict();
/** The fixed user an image runs as, when it is not root; its data folders are handed to it. */
export const dataOwnerSchema = z
  .object({ uid: z.number().int().min(1), gid: z.number().int().min(1) })
  .strict();
export const fixedPortSchema = z
  .object({ containerPort: port, hostPort: port, protocol: z.enum(['tcp', 'udp']) })
  .strict();

const guideSchema = z
  .object({
    afterInstall: steps,
    server: z
      .object({
        linux: z.object({ default: steps }).catchall(steps).optional(),
        windows: steps.optional(),
        macos: steps.optional(),
      })
      .strict()
      .optional(),
    devices: z
      .object({
        router: steps.optional(),
        windows: steps.optional(),
        macos: steps.optional(),
        linux: steps.optional(),
        android: steps.optional(),
        ios: steps.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const catalogEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().min(1).max(120),
    category: z.enum(CATEGORIES),
    icon: z.string().regex(/^icons\/[a-z0-9-]+\.svg$/),
    image: z.string().refine(isPinnedImage, 'image tag must be pinned to a version, not latest'),
    containerPort: port,
    defaultHostPort: port,
    openPath: z.string().startsWith('/').optional(),
    env: z.record(envKey, z.string()).default({}),
    volumes: z.array(volumeSchema).default([]),
    fixedPorts: z.array(fixedPortSchema).default([]),
    dataOwner: dataOwnerSchema.optional(),
    generatedSecrets: z
      .array(z.object({ name: z.string().regex(/^[A-Za-z0-9]+$/), label: z.string().min(1), env: envKey }).strict())
      .default([]),
    guide: guideSchema,
  })
  .strict();

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type Guide = CatalogEntry['guide'];
export type GuideStep = z.infer<typeof step>;
export type Volume = z.infer<typeof volumeSchema>;
export type FixedPort = z.infer<typeof fixedPortSchema>;
export type DataOwner = z.infer<typeof dataOwnerSchema>;
export type GeneratedSecret = CatalogEntry['generatedSecrets'][number];
