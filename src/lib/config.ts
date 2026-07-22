import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });

export const config = {
  database: {
    url: process.env.DATABASE_URL || "file:./9drive.db",
  },
  mcp: {
    transport: (process.env.MCP_TRANSPORT || "stdio") as "stdio" | "sse",
    port: parseInt(process.env.MCP_PORT || "3500", 10),
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      "http://localhost:3500/oauth/google/callback",
  },
  encryption: {
    key: process.env.TOKEN_ENCRYPTION_KEY || "",
  },
  upload: {
    policy: (process.env.UPLOAD_POLICY || "most-available") as
      | "most-available"
      | "round-robin"
      | "priority-order",
    maxBytes: parseInt(process.env.MAX_UPLOAD_BYTES || "5368709120", 10),
  },
};
