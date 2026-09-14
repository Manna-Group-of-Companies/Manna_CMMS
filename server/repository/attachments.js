import { deleteDoc, getDoc, listDocs, uploadFile } from "../integrations/erpnext/client.js";

/**
 * Files hung off a record — drawings, manuals, specifications.
 *
 * Shared because two things need it and the rules are the same for both: a
 * machine and an electrical system both come with paperwork, and neither has
 * anywhere else sensible to keep it.
 *
 * It is deliberately the *only* structured detail either of them carries now.
 * Machines had a component list and electrical systems had subsystems and
 * components; both were removed in favour of a document, because a maintenance
 * team that already keeps a Word file per machine will keep that file up to
 * date and will not keep a form up to date as well. One accurate document beats
 * two half-filled records.
 */

/**
 * The largest file this will take, before base64.
 *
 * The browser sends it base64-encoded inside JSON, which inflates it by about a
 * third, so this sits comfortably under the body limit. Generous enough for a
 * scanned manual and a drawing, and deliberately not generous enough for a full
 * CAD assembly — those belong on a drive with a link recorded in the notes.
 */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Everything attached to one record. */
export const listAttachments = async (doctype, docname) => {
  const files = await listDocs("File", {
    fields: ["name", "file_name", "file_url", "file_size", "is_private", "creation"],
    filters: [
      ["File", "attached_to_doctype", "=", doctype],
      ["File", "attached_to_name", "=", docname],
    ],
    limit: 200,
  }).catch(() => []);

  return files.map((f) => ({
    id: f.name,
    fileName: f.file_name,
    url: f.file_url,
    size: Number(f.file_size || 0),
    isPrivate: Boolean(f.is_private),
    addedAt: f.creation,
  }));
};

/** How many files each of these records holds. */
export const attachmentCounts = async (doctype, ids) => {
  if (!ids.length) return new Map();

  const files = await listDocs("File", {
    fields: ["attached_to_name"],
    filters: [
      ["File", "attached_to_doctype", "=", doctype],
      ["File", "attached_to_name", "in", ids],
    ],
    limit: 500,
  }).catch(() => []);

  const counts = new Map();
  for (const f of files) {
    counts.set(f.attached_to_name, (counts.get(f.attached_to_name) || 0) + 1);
  }
  return counts;
};

/**
 * Attaches a file, privately.
 *
 * Private on purpose: a machine drawing is not something to serve from a
 * guessable public URL.
 */
export const attach = async (doctype, docname, { fileName, contentType, dataBase64 } = {}) => {
  if (!(await getDoc(doctype, docname).catch(() => null))) {
    throw new Error(`There is no ${doctype} called "${docname}"`);
  }

  const name = String(fileName || "").trim();
  if (!name) throw new Error("A file name is required");
  if (!dataBase64) throw new Error("The file is empty");

  const buffer = Buffer.from(dataBase64, "base64");
  if (buffer.length === 0) throw new Error("The file is empty");
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error(
      `That file is ${(buffer.length / 1024 / 1024).toFixed(1)} MB. The limit is ` +
        `${MAX_FILE_BYTES / 1024 / 1024} MB — put anything larger on a shared drive and record the link in the notes.`
    );
  }

  let result;
  try {
    result = await uploadFile({
      buffer,
      fileName: name,
      contentType: String(contentType || "").toLowerCase() || "application/octet-stream",
      doctype,
      docname,
      isPrivate: true,
    });
  } catch (error) {
    // ERPNext reads a PDF as it stores it and refuses one it cannot parse — a
    // truncated download, or something else renamed. That is the uploader's to
    // fix, so it must not be reduced to a generic failure.
    if (/pypdf|PdfRead|PdfStream/i.test(error.message)) {
      throw new Error(
        `ERPNext could not read "${name}" as a PDF. It may be truncated, or not really a PDF. ` +
          "Try opening it, re-saving it, and uploading again."
      );
    }
    throw error;
  }

  return {
    id: result?.name,
    fileName: result?.file_name || name,
    url: result?.file_url || "",
    size: Number(result?.file_size || buffer.length),
  };
};

/** Removes one attachment, having checked it belongs where the caller says. */
export const detach = async (doctype, docname, fileId) => {
  const file = await getDoc("File", fileId).catch(() => null);
  if (!file) throw new Error("That file is not there");

  // Checked rather than trusted: without it, a file id from anywhere in
  // ERPNext could be deleted through this route.
  if (file.attached_to_doctype !== doctype || file.attached_to_name !== docname) {
    throw new Error("That file does not belong to this record");
  }

  await deleteDoc("File", fileId);
  return { removed: fileId };
};
