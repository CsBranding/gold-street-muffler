/** Emits JSON Schema files for every config file into /schemas. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import * as S from '../src/schema/schemas';

const files: Record<string, z.ZodType> = {
  game: S.GameFileSchema,
  factions: S.FactionsFileSchema,
  characters: S.CharactersFileSchema,
  weapons: S.WeaponsFileSchema,
  enemies: S.EnemiesFileSchema,
  bosses: S.BossesFileSchema,
  levels: S.LevelsFileSchema,
  economy: S.EconomyFileSchema,
  assets: S.AssetsFileSchema,
};
mkdirSync('schemas', { recursive: true });
for (const [name, schema] of Object.entries(files)) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  writeFileSync(`schemas/${name}.schema.json`, JSON.stringify({ title: `BLOCK WARS ${name}.json`, ...json }, null, 2) + '\n');
  console.log(`schemas/${name}.schema.json`);
}
