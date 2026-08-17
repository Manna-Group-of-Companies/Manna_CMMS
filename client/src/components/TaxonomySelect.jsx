import { useEffect, useState } from "react";
import API from "../services/api";

/**
 * Category and sub-category pickers, backed by the classifications already in
 * use in the catalog.
 *
 * A plain text box was the reason the catalog holds "Bearing", "Bearings" and
 * "BEARING" as three separate categories. A closed dropdown would be worse: the
 * store genuinely does meet a class of item it has never stocked. So these are
 * dropdowns with one escape hatch — "Add a new one…" — which makes the existing
 * value the easy choice and inventing one a deliberate act.
 */

/** The sentinel option that swaps the dropdown for a text box. */
const OTHER = "__other__";

/** Categories in use across the catalog. */
export const useCategoryOptions = () => {
  const [options, setOptions] = useState([]);

  useEffect(() => {
    API.get("/products/categories")
      .then(({ data }) =>
        setOptions(
          (data || [])
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b)),
        ),
      )
      // The picker still works typed-in if this fails; it just loses the list.
      .catch((error) => console.error("Error loading categories:", error));
  }, []);

  return options;
};

/**
 * Sub-categories in use, narrowed to [category].
 *
 * Scoped rather than global on purpose: the catalog holds well over a hundred,
 * and an unfiltered list is unusable in a dropdown.
 */
export const useSubCategoryOptions = (category) => {
  const [options, setOptions] = useState([]);

  useEffect(() => {
    if (!category) {
      setOptions([]);
      return;
    }

    let live = true;
    API.get("/products/subcategories", { params: { category } })
      .then(({ data }) => {
        if (live) setOptions((data || []).filter(Boolean));
      })
      .catch((error) => console.error("Error loading sub-categories:", error));

    return () => {
      live = false;
    };
  }, [category]);

  return options;
};

/**
 * A dropdown over [options], with a "type a new one" mode.
 *
 * The mode is latched in state rather than derived from whether `value` is in
 * `options`: the lists load asynchronously, and deriving it would kick the
 * field into free-text for a moment on every open, losing the user's place.
 */
const TaxonomySelect = ({
  value = "",
  options = [],
  onChange,
  placeholder = "Select…",
  newLabel = "＋ Add a new one…",
  disabled = false,
  required = false,
  id,
}) => {
  const [typing, setTyping] = useState(false);

  // A value that is not one of the known options can only be free text, so the
  // field opens in the mode that can actually display it.
  useEffect(() => {
    if (value && options.length && !options.includes(value)) setTyping(true);
  }, [value, options]);

  const handleSelect = (e) => {
    const picked = e.target.value;
    if (picked === OTHER) {
      setTyping(true);
      // Cleared, so the text box starts empty rather than holding the value the
      // user just decided was wrong.
      onChange("");
      return;
    }
    setTyping(false);
    onChange(picked);
  };

  if (typing) {
    return (
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={required}
          autoFocus
          placeholder={placeholder}
          className="field flex-1"
        />
        <button
          type="button"
          onClick={() => {
            setTyping(false);
            onChange("");
          }}
          disabled={disabled}
          className="btn btn-neutral shrink-0"
          title="Pick from the list instead"
        >
          List
        </button>
      </div>
    );
  }

  return (
    <select
      id={id}
      value={options.includes(value) ? value : ""}
      onChange={handleSelect}
      disabled={disabled}
      required={required}
      className="field cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
      <option value={OTHER}>{newLabel}</option>
    </select>
  );
};

export default TaxonomySelect;
