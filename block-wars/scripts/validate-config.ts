import { loadConfig } from '../src/schema/loadConfig';
const cfg = loadConfig();
console.log(`config OK: ${cfg.weapons.weapons.length} weapons, ${cfg.enemies.enemies.length} enemies, ${cfg.levels.maps.length} maps`);
