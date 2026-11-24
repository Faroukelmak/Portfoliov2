# Blog

Un article = un fichier Markdown dans ce dossier.

1. Copie `_template.md`, renomme-le (`mon-sujet.md` → URL `/blog/mon-sujet/`).
   Version anglaise (optionnelle) dans `mon-sujet.en.md` → URL `/en/blog/mon-sujet/`. Le bouton FR / EN passe de l'une à l'autre.
2. Remplis le front matter (`title`, `date`, `excerpt`, `tags`) et écris l'article.
3. Génère les pages :

   ```bash
   node scripts/build-blog.mjs
   ```

4. Commit `content/blog/`, `blog/` et `en/blog/` (les pages générées), puis push. Vercel déploie.

Images : dépose-les dans `assets/blog/` et référence-les avec `/assets/blog/mon-image.webp`.
Brouillon : `draft: true` dans le front matter, ou un nom de fichier qui commence par `_`.

Blocs utiles dans le Markdown

- ` ```python ` pour du code coloré avec bouton Copier
- ` ```output ` pour un bloc Résultat (` ```output Mon titre ` pour changer le titre)
- `:yes:` et `:no:` pour les icônes dans un tableau
- `versions: [pydantic 2.14.4, langchain 1.5.0]` et `model: ...` dans le front matter pour l'encart Environnement de test
