# Corealm game documentation

Generated from canonical content by `npm run gen-docs`. Do not edit these files by hand —
they are regenerated from the same tables the game itself reads, which is what keeps them
from drifting away from what the game actually does.

- [experience](./experience.md)
- [skills](./skills.md)
- [items](./items.md)
- [recipes](./recipes.md)
- [enemies](./enemies.md)
- [resources](./resources.md)
- [regions](./regions.md)
- [quests](./quests.md)
- [spells and shops](./spells-and-shops.md)

## Counts

One row per thing that exists, matching the page it links to. Enemies and resources also
publish alias ids so a lookup by world group resolves to the same block; those aliases are
lookup keys rather than content, and are counted separately below.

| Table | Rows |
| --- | --- |
| Items | 102 |
| Resources | 12 |
| Recipes | 78 |
| Spells | 3 |
| Enemies | 9 |
| Shops | 5 |
| Quests | 10 |
| Regions | 3 |
| Skills | 11 |

| Lookup table | Ids that resolve |
| --- | --- |
| Enemy ids (blocks + group aliases) | 21 |
| Resource ids (archetypes + cluster aliases) | 26 |
