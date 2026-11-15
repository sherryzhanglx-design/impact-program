# Building the ITC exercise page

`mindset-itc/index.html` in the repository is the **encrypted** page (StatiCrypt,
unlocked with the class code). No plaintext copy is kept in the repository.

## Edit the page

```bash
cd impact-itc-coach/page
npx staticrypt@3.5.4 ../../mindset-itc/index.html --decrypt -d src   # asks for the class code
# edit src/index.html, then:
./build.sh src/index.html                                           # asks for the class code
```

`build.sh` re-encrypts with the custom Chinese unlock screen (`itc_template.html`).
The template stores the code in `localStorage["impact-itc-classcode"]` so the AI
coach does not ask again, and uses its own "remember me" keys
(`itc_staticrypt_*`) so it never clears the Portal's remembered password on the
same domain. Delete `src/` afterwards; do not commit it.
