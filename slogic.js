// slogic.js — Solid Note CRUD App
// extends https://github.com/ewingson/solid-basic
// stores note at https://[pod-root]/public/the_note
// vocabulary: Dublin Core Terms (dcterms)

// --- SECTION 1: CONFIGURATION ---

let SOLID_OIDC_ISSUER = "";

// Profile predicates (from solid-basic)
const FOAF_NAME_PREDICATE    = "http://xmlns.com/foaf/0.1/name";
const VC_FN_PREDICATE        = "http://www.w3.org/2006/vcard/ns#fn";
const PREF_PREDICATE         = "http://www.w3.org/ns/pim/space#preferencesFile";
const PUB_TI_PREDICATE       = "http://www.w3.org/ns/solid/terms#publicTypeIndex";
const PRIV_TI_PREDICATE      = "http://www.w3.org/ns/solid/terms#privateTypeIndex";
const PIMSTORAGE_PREDICATE   = "http://www.w3.org/ns/pim/space#storage";

// Dublin Core Terms predicates used for the note
const DC_TITLE       = "http://purl.org/dc/terms/title";
const DC_DESCRIPTION = "http://purl.org/dc/terms/description";
const DC_CREATOR     = "http://purl.org/dc/terms/creator";
const DC_CREATED     = "http://purl.org/dc/terms/created";
const DC_MODIFIED    = "http://purl.org/dc/terms/modified";
const DC_TYPE        = "http://purl.org/dc/terms/type";
const DC_IDENTIFIER  = "http://purl.org/dc/terms/identifier";
const DCMITYPE_TEXT  = "http://purl.org/dc/dcmitype/Text";

const NOTE_PATH = "public/the_note";

// --- SECTION 2: UI ELEMENT REFERENCES ---

const loadingDiv    = document.getElementById('loading');
const guestDiv      = document.getElementById('auth-guest');
const userDiv       = document.getElementById('auth-user');
const loginButton   = document.getElementById('login-button');
const logoutButton  = document.getElementById('logout-button');
const usernameSpan  = document.getElementById('username');
const webidSpan     = document.getElementById('webid');
const fnSpan        = document.getElementById('fn');
const prefSpan      = document.getElementById('pref');
const pubindexSpan  = document.getElementById('pubind');
const privindexSpan = document.getElementById('privind');
const storageSpan   = document.getElementById('root');

const noteUrlEl    = document.getElementById('note-url');
const noteMetaDiv  = document.getElementById('note-meta');
const noteBodyEl   = document.getElementById('note-body');
const statusEl     = document.getElementById('status');

const btnRead   = document.getElementById('btn-read');
const btnCreate = document.getElementById('btn-create');
const btnUpdate = document.getElementById('btn-update');
const btnDelete = document.getElementById('btn-delete');

// Filled after login
let currentWebId  = "";
let currentNoteUrl = "";

// --- SECTION 3: CORE SOLID PROFILE LOGIC (from solid-basic) ---

async function main() {
    try {
        await solidClientAuthentication.handleIncomingRedirect({ restorePreviousSession: true });
        const session = solidClientAuthentication.getDefaultSession();

        if (!session.info.isLoggedIn) {
            updateUI(false);
            return;
        }

        currentWebId = session.info.webId;

        const user        = await fetchUserProfile(currentWebId);
        const fname       = await secondFetch(currentWebId);
        const preferences = await preferencesFetch(currentWebId);
        const pubti       = await pubIFetch(currentWebId);
        const privti      = await privIFetch(currentWebId);
        const pims        = await rootstorageFetch(currentWebId);

        currentNoteUrl = pims.replace(/\/?$/, '/') + NOTE_PATH;
        noteUrlEl.textContent = currentNoteUrl;

        updateUI(true, user.name, currentWebId, fname, preferences, pubti, privti, pims);

    } catch (error) {
        alert(error.message);
        updateUI(false);
    }
}

function getLoginUrl() {
    const url = prompt('Introduce your Solid login url (this is your pod-provider or idp)');
    if (!url) return null;
    const loginUrl = new URL(url);
    loginUrl.hash = '';
    loginUrl.pathname = '';
    return loginUrl.href;
}

async function fetchUserProfile(webId) {
    const profileQuads = await readSolidDocument(webId);
    const nameQuad = profileQuads.find(q => q.predicate.value === FOAF_NAME_PREDICATE);
    return { name: nameQuad?.object.value || 'Anonymous' };
}

async function secondFetch(webId) {
    const profileQuads = await readSolidDocument(webId);
    const fnQuad = profileQuads.find(q => q.predicate.value === VC_FN_PREDICATE);
    return fnQuad?.object.value || 'not set';
}

async function preferencesFetch(webId) {
    const profileQuads = await readSolidDocument(webId);
    const prefQuad = profileQuads.find(q => q.predicate.value === PREF_PREDICATE);
    return prefQuad?.object.value || 'hmm, not found';
}

async function pubIFetch(webId) {
    const profileQuads = await readSolidDocument(webId);
    const pubiQuad = profileQuads.find(q => q.predicate.value === PUB_TI_PREDICATE);
    return pubiQuad?.object.value || 'not found';
}

async function privIFetch(webId) {
    const profileQuads = await readSolidDocument(webId);
    const priviQuad = profileQuads.find(q => q.predicate.value === PRIV_TI_PREDICATE);
    return priviQuad?.object.value || 'not found';
}

async function rootstorageFetch(webId) {
    const profileQuads = await readSolidDocument(webId);
    const storageQuad = profileQuads.find(q => q.predicate.value === PIMSTORAGE_PREDICATE);
    return storageQuad?.object.value || await findUserStorage(webId);
}

async function readSolidDocument(url) {
    const response = await solidClientAuthentication.fetch(url, {
        headers: { Accept: 'text/turtle' }
    });
    if (Math.floor(response.status / 100) !== 2) return [];
    const data = await response.text();
    const parser = new N3.Parser({ baseIRI: url });
    return parser.parse(data);
}

async function findUserStorage(url) {
    url = url.replace(/#.*$/, '');
    url = url.endsWith('/') ? url + '../' : url + '/../';
    url = new URL(url);
    const response = await solidClientAuthentication.fetch(url.href);
    if (response.headers.get('Link')?.includes('<http://www.w3.org/ns/pim/space#Storage>; rel="type"'))
        return url.href;
    if (url.pathname === '/') return url.href;
    return findUserStorage(url.href);
}

// --- SECTION 4: NOTE CRUD OPERATIONS ---

/**
 * Builds a Turtle document for the note.
 * Uses all 7 DC fields: title, description, creator, created, modified, type, identifier.
 */
function buildNoteTurtle(noteUrl, webId, description, existingCreated) {
    const now = new Date().toISOString();
    const created = existingCreated || now;

    // Escape literals safely
    const esc = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

    return `@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix dcmitype: <http://purl.org/dc/dcmitype/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<${noteUrl}>
    dcterms:title       "this Solid Note" ;
    dcterms:description "${esc(description)}" ;
    dcterms:creator     <${webId}> ;
    dcterms:created     "${created}"^^xsd:dateTime ;
    dcterms:modified    "${now}"^^xsd:dateTime ;
    dcterms:type        dcmitype:Text ;
    dcterms:identifier  "${noteUrl}" .
`;
}

/** Writes (PUT) the Turtle note to the pod. */
async function writeNote(description, existingCreated) {
    const turtle = buildNoteTurtle(currentNoteUrl, currentWebId, description, existingCreated);
    const response = await solidClientAuthentication.fetch(currentNoteUrl, {
        method: 'PUT',
        headers: {
            'Content-Type': 'text/turtle',
            'Link': '<http://www.w3.org/ns/ldp#Resource>; rel="type"'
        },
        body: turtle
    });
    return response;
}

/** Reads the note and populates the meta table and textarea. */
async function readNote() {
    setStatus('Reading note…');
    try {
        const quads = await readSolidDocument(currentNoteUrl);
        if (!quads.length) {
            setStatus('No note found at this location.');
            noteMetaDiv.setAttribute('hidden', '');
            noteBodyEl.value = '';
            return null;
        }

        const get = pred => quads.find(q => q.predicate.value === pred)?.object.value || '';

        const meta = {
            title:       get(DC_TITLE),
            description: get(DC_DESCRIPTION),
            creator:     get(DC_CREATOR),
            created:     get(DC_CREATED),
            modified:    get(DC_MODIFIED),
            type:        get(DC_TYPE),
            identifier:  get(DC_IDENTIFIER),
        };

        document.getElementById('n-title').textContent      = meta.title;
        document.getElementById('n-creator').textContent    = meta.creator;
        document.getElementById('n-created').textContent    = meta.created;
        document.getElementById('n-modified').textContent   = meta.modified;
        document.getElementById('n-type').textContent       = meta.type;
        document.getElementById('n-identifier').textContent = meta.identifier;

        noteBodyEl.value = meta.description;
        noteMetaDiv.removeAttribute('hidden');

        setStatus('Note loaded.');
        return meta;
    } catch (e) {
        setStatus('Error reading note: ' + e.message);
        return null;
    }
}

/** Creates the note (fails if already exists — uses PUT which overwrites; server may 409 if locked). */
async function createNote() {
    const description = noteBodyEl.value.trim();
    if (!description) { setStatus('Please enter some text first.'); return; }

    setStatus('Creating note…');
    try {
        // Check existence first
        const check = await solidClientAuthentication.fetch(currentNoteUrl, { method: 'HEAD' });
        if (check.ok) {
            setStatus('Note already exists. Use Update to change it, or Delete first.');
            return;
        }

        const response = await writeNote(description, null);
        if (response.ok || response.status === 201) {
            setStatus('Note created.');
            await readNote();
        } else {
            setStatus(`Create failed: ${response.status} ${response.statusText}`);
        }
    } catch (e) {
        setStatus('Error creating note: ' + e.message);
    }
}

/** Updates the note, preserving the original dcterms:created date. */
async function updateNote() {
    const description = noteBodyEl.value.trim();
    if (!description) { setStatus('Please enter some text first.'); return; }

    setStatus('Updating note…');
    try {
        // Read existing to preserve created date
        const existing = await readNote();
        const existingCreated = existing?.created || null;

        const response = await writeNote(description, existingCreated);
        if (response.ok) {
            setStatus('Note updated.');
            await readNote();
        } else {
            setStatus(`Update failed: ${response.status} ${response.statusText}`);
        }
    } catch (e) {
        setStatus('Error updating note: ' + e.message);
    }
}

/** Deletes the note from the pod. */
async function deleteNote() {
    if (!confirm(`Delete the note at\n${currentNoteUrl}?`)) return;

    setStatus('Deleting note…');
    try {
        const response = await solidClientAuthentication.fetch(currentNoteUrl, {
            method: 'DELETE'
        });
        if (response.ok || response.status === 204) {
            noteMetaDiv.setAttribute('hidden', '');
            noteBodyEl.value = '';
            setStatus('Note deleted.');
        } else {
            setStatus(`Delete failed: ${response.status} ${response.statusText}`);
        }
    } catch (e) {
        setStatus('Error deleting note: ' + e.message);
    }
}

function setStatus(msg) {
    statusEl.textContent = msg;
}

// --- SECTION 5: UI AND EVENT HANDLING ---

function updateUI(isLoggedIn, name, webidname, fName, preF, pubTI, privTI, pimS) {
    loadingDiv.setAttribute('hidden', '');

    if (isLoggedIn) {
        guestDiv.setAttribute('hidden', '');
        userDiv.removeAttribute('hidden');
        usernameSpan.textContent  = name;
        webidSpan.textContent     = webidname;
        fnSpan.textContent        = fName;
        prefSpan.textContent      = preF;
        pubindexSpan.textContent  = pubTI;
        privindexSpan.textContent = privTI;
        storageSpan.textContent   = pimS;
    } else {
        userDiv.setAttribute('hidden', '');
        guestDiv.removeAttribute('hidden');
    }
}

loginButton.onclick = () => {
    SOLID_OIDC_ISSUER = getLoginUrl();
    if (!SOLID_OIDC_ISSUER) return;
    solidClientAuthentication.login({
        oidcIssuer:  SOLID_OIDC_ISSUER,
        redirectUrl: window.location.href,
        clientName:  'Solid Note App'
    });
};

logoutButton.onclick = async () => {
    logoutButton.setAttribute('disabled', '');
    await solidClientAuthentication.logout();
    logoutButton.removeAttribute('disabled');
    updateUI(false);
};

btnRead.onclick   = readNote;
btnCreate.onclick = createNote;
btnUpdate.onclick = updateNote;
btnDelete.onclick = deleteNote;

// --- SECTION 6: START ---
main();
