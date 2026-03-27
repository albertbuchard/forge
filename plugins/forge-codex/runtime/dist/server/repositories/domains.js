import { getDatabase } from "../db.js";
import { domainSchema } from "../psyche-types.js";
function mapDomain(row) {
    return domainSchema.parse({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        themeColor: row.theme_color,
        sensitive: row.sensitive === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}
export function listDomains() {
    const rows = getDatabase()
        .prepare(`SELECT id, slug, title, description, theme_color, sensitive, created_at, updated_at
       FROM domains
       ORDER BY sensitive DESC, title`)
        .all();
    return rows.map(mapDomain);
}
export function getDomainBySlug(slug) {
    const row = getDatabase()
        .prepare(`SELECT id, slug, title, description, theme_color, sensitive, created_at, updated_at
       FROM domains
       WHERE slug = ?`)
        .get(slug);
    return row ? mapDomain(row) : undefined;
}
