import { useEffect, useState } from "react";
import API from "../services/api";

/**
 * The companies stock is kept in, as the API holds them (ST-33).
 *
 * Every picker used to carry its own hardcoded pair, which is why adding or
 * renaming a company meant editing the console and the app and shipping a
 * release before anybody could file stock against it. There are three of them
 * now and there will be more, so the list is read rather than written down.
 *
 * A failure leaves it empty rather than throwing: a filter with no options is
 * a smaller problem than a catalog that will not render.
 */
const useStockRooms = () => {
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await API.get("/stock-rooms");
        if (!cancelled) setRooms(data);
      } catch (error) {
        console.error("Error loading companies:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return rooms;
};

export default useStockRooms;
