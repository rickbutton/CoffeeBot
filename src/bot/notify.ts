import type { Client } from "discord.js";
import { log } from "../util/log.js";

export async function notifyAdmins(
    client: Client,
    adminUserIds: Iterable<string>,
    content: string,
): Promise<void> {
    for (const id of adminUserIds) {
        try {
            const dm = await (await client.users.fetch(id)).createDM();
            await dm.send({ content, allowedMentions: { parse: [] } });
        } catch (err) {
            log.warn({ err, adminId: id }, "notifyAdmins: failed to DM admin");
        }
    }
}
