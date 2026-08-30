import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const repoSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().optional(),
  token: z.string().min(1),
});

const attachmentSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  isImage: z.boolean(),
  dataBase64: z.string(),
  text: z.string().optional(),
  usage: z.enum(["reference", "add"]).default("reference"),
});

const chatSchema = z.object({
  repo: repoSchema,
  message: z.string().min(1),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
  attachments: z.array(attachmentSchema).default([]),
});

export const connectRepo = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => repoSchema.parse(input))
  .handler(async ({ data }) => {
    const { getRepoInfo } = await import("./github.server");
    const info = await getRepoInfo(data);
    return {
      fullName: info.full_name,
      defaultBranch: info.default_branch,
      private: info.private,
      url: info.html_url,
      description: info.description,
      avatarUrl: info.owner.avatar_url,
    };
  });

export const sendAgentMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => chatSchema.parse(input))
  .handler(async ({ data }) => {
    const { runAgent } = await import("./agent.server");
    return runAgent(data);
  });
