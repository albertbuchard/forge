import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import type { RootState } from "@/store/root-reducer";
import type { AppDispatch } from "@/store/store";

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
