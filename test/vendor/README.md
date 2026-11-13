# Demo dependencies

The demo loads local copies so it can run without a CDN:

- `jquery-3.7.1/dist/jquery.js`: from the `jquery@3.7.1` npm tarball.
- `jquery-ui-1.13.3/`: JavaScript, CSS and images from the
  `jquery-ui-dist@1.13.3` npm tarball.

Both distributions include their upstream `LICENSE.txt`. To update, download
with `npm pack jquery@<version> jquery-ui-dist@<version>`, replace these copies,
and update the paths in `../simple.html`. Remove superseded copies so dependency
scanners do not continue reporting unused vulnerable code.
