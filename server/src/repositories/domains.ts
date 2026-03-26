import { getDatabase } from "../db.js";
import { domainSchema, type Domain } from "../psyche-types.js";

type DomainRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  theme_color: string;
  sensitive: number;
  created_at: string;
  updated_at: string;
};

function mapDomain(row: DomainRow): Domain {
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

export function listDomains(): Domain[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, slug, title, description, theme_color, sensitive, created_at, updated_at
       FROM domains
       ORDER BY sensitive DESC, title`
    )
    .all() as DomainRow[];
  return rows.map(mapDomain);
}

export function getDomainBySlug(slug: string): Domain | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT id, slug, title, description, theme_color, sensitive, created_at, updated_at
       FROM domains
       WHERE slug = ?`
    )
    .get(slug) as DomainRow | undefined;
  return row ? mapDomain(row) : undefined;
}
