# Blog

Un article = un fichier Markdown dans ce dossier.

1. Copie `_template.md`, renomme-le (`mon-sujet.md` → URL `/blog/mon-sujet/`).
2. Remplis le front matter (`title`, `date`, `excerpt`, `tags`) et écris l'article.
3. Génère les pages :

   ```bash
   node scripts/build-blog.mjs
   ```

4. Commit `content/blog/` **et** `blog/` (les pages générées), puis push : Vercel déploie.

Images : dépose-les dans `assets/blog/` et référence-les avec `/assets/blog/mon-image.webp`.
Brouillon : `draft: true` dans le front matter, ou un nom de fichier qui commence par `_`.
