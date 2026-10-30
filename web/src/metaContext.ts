import { createContext, useContext } from "react";
import type { NodeTypeMap } from "./types.ts";

const EMPTY: NodeTypeMap = { byType: {}, all: [] };

export const MetaContext = createContext<NodeTypeMap>(EMPTY);

export const useMeta = (): NodeTypeMap => useContext(MetaContext);
