/**
 * The app's own version, in one place.
 *
 * Was spelled "v1" inline in the header and in the document title, which meant
 * the two could drift apart and neither was traceable to anything. Note this is
 * deliberately not read from package.json: that field is the npm package
 * version (0.1.0), which is not the same thing as the release the user is on,
 * and bundling package.json into the client to read one string is not worth it.
 * If the two ever need to agree, raise the package version and change this.
 */
export const APP_VERSION = "1.0.0";
