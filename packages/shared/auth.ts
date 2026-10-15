import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { db, now } from "./db.ts";
import { config } from "./config.ts";
import { AppError } from "../domain/index.ts";
export type User = { id: string; name: string; role_id: string };
const digest = (t: string) => createHash("sha256").update(t).digest("hex");
export function login(username: string, password: string) {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(username) as
    User | undefined;
  const expected = config.OPERATOR_PASSWORD ?? "local-demo";
  const a = Buffer.from(digest(password)),
    b = Buffer.from(digest(expected));
  if (!user || !timingSafeEqual(a, b))
    throw new AppError(401, "Invalid credentials", "AUTH");
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
    digest(token),
    user.id,
    new Date(Date.now() + 8 * 3600_000).toISOString(),
  );
  return { token, user };
}
export function session(token: string | undefined) {
  if (!token) return null;
  return db
    .prepare(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
    )
    .get(digest(token), now()) as User | undefined;
}
export function logout(token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
}
export function requirePermission(
  user: User | null | undefined,
  action: string,
) {
  if (!user) throw new AppError(401, "Sign in required", "AUTH");
  if (
    !db
      .prepare("SELECT 1 FROM permissions WHERE role_id=? AND action=?")
      .get(user.role_id, action)
  )
    throw new AppError(403, `Permission required: ${action}`, "PERMISSION");
}
