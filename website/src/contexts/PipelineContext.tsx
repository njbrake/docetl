import React, {
  useState,
  useCallback,
  createContext,
  useContext,
  useEffect,
  useRef,
} from "react";
import { Operation, File, OutputType, Bookmark } from "@/app/types";
import {
  mockFiles,
  initialOperations,
  mockSampleSize,
  mockPipelineName,
} from "@/mocks/mockData";
import * as localStorageKeys from "@/app/localStorageKeys";
import { BOOKMARKS_STORAGE_KEY } from "@/app/localStorageKeys";

interface PipelineState {
  operations: Operation[];
  currentFile: File | null;
  output: OutputType | null;
  terminalOutput: string;
  optimizerProgress: {
    status: string;
    progress: number;
    shouldOptimize: boolean;
    rationale: string;
    validatorPrompt: string;
  } | null;
  isLoadingOutputs: boolean;
  numOpRun: number;
  pipelineName: string;
  sampleSize: number | null;
  files: File[];
  cost: number;
  defaultModel: string;
  optimizerModel: string;
}

interface PipelineContextType extends PipelineState {
  setOperations: React.Dispatch<React.SetStateAction<Operation[]>>;
  setCurrentFile: React.Dispatch<React.SetStateAction<File | null>>;
  setOutput: React.Dispatch<React.SetStateAction<OutputType | null>>;
  setTerminalOutput: React.Dispatch<React.SetStateAction<string>>;
  setOptimizerProgress: React.Dispatch<
    React.SetStateAction<{
      status: string;
      progress: number;
      shouldOptimize: boolean;
      rationale: string;
      validatorPrompt: string;
    } | null>
  >;
  setIsLoadingOutputs: React.Dispatch<React.SetStateAction<boolean>>;
  setNumOpRun: React.Dispatch<React.SetStateAction<number>>;
  setPipelineName: React.Dispatch<React.SetStateAction<string>>;
  setSampleSize: React.Dispatch<React.SetStateAction<number | null>>;
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  setCost: React.Dispatch<React.SetStateAction<number>>;
  setDefaultModel: React.Dispatch<React.SetStateAction<string>>;
  setOptimizerModel: React.Dispatch<React.SetStateAction<string>>;
  saveProgress: () => void;
  unsavedChanges: boolean;
  clearPipelineState: () => void;
  serializeState: () => Promise<string>;
}

const PipelineContext = createContext<PipelineContextType | undefined>(
  undefined
);

const loadFromLocalStorage = <T,>(key: string, defaultValue: T): T => {
  if (typeof window !== "undefined") {
    const storedValue = localStorage.getItem(key);
    return storedValue ? JSON.parse(storedValue) : defaultValue;
  }
  return defaultValue;
};

const serializeState = async (state: PipelineState): Promise<string> => {
  const bookmarks = loadFromLocalStorage(BOOKMARKS_STORAGE_KEY, []);

  // Get important output samples
  let outputSample = "";
  let currentOperationName = "";
  let schemaInfo = "";

  if (state.output?.path) {
    try {
      const outputResponse = await fetch(
        `/api/readFile?path=${state.output.path}`
      );
      if (!outputResponse.ok) {
        throw new Error("Failed to fetch output file");
      }

      const outputContent = await outputResponse.text();
      const outputs = JSON.parse(outputContent) || [];

      if (outputs.length > 0) {
        // Get the operation that generated this output
        const operation = state.operations.find(
          (op) => op.id === state.output?.operationId
        );
        currentOperationName = operation?.name || "";
        const importantColumns =
          operation?.output?.schema?.map((item) => item.key) || [];

        // Generate schema information
        if (outputs.length > 0) {
          const firstRow = outputs[0];
          schemaInfo = Object.entries(firstRow)
            .map(([key, value]) => {
              const type = typeof value;
              return `- ${key}: ${type}${
                importantColumns.includes(key)
                  ? " (output of current operation)"
                  : ""
              }`;
            })
            .join("\n");
        }

        // Take up to 5 samples
        const samples = outputs
          .slice(0, 5)
          .map((row: Record<string, unknown>) => {
            const sampleRow: Record<string, unknown> = {};

            // Prioritize important columns
            importantColumns.forEach((col) => {
              if (col in row) {
                const value = String(row[col]);
                if (value.length > 10000) {
                  sampleRow[`**${col}**`] =
                    `**${value.slice(0, 10000)}` +
                    `** ... (${value.length - 10000} more characters)`;
                } else {
                  sampleRow[`**${col}**`] = `**${value}**`;
                }
              }
            });

            // Add other columns in addition to important ones
            Object.keys(row).forEach((key) => {
              if (!(key in sampleRow)) {
                // Only add if not already added
                const value = String(row[key]);
                if (value.length > 10000) {
                  sampleRow[key] =
                    value.slice(0, 10000) +
                    ` ... (${value.length - 10000} more characters)`;
                } else {
                  sampleRow[key] = value;
                }
              }
            });

            return sampleRow;
          });

        outputSample =
          samples.length > 0 ? JSON.stringify(samples, null, 2) : "";
      }
    } catch {
      outputSample = "\nError parsing output samples";
    }
  }

  // Format operations details
  const operationsDetails = state.operations
    .map((op) => {
      return `
- Operation: ${op.name} (${op.type})
  Type: ${op.type}
  Is LLM: ${op.llmType ? "Yes" : "No"}
  Prompt (relevant for llm operations): ${op.prompt || "No prompt"}
  Output Schema (relevant for llm operations): ${JSON.stringify(
    op.output?.schema || []
  )}
  Other arguments: ${JSON.stringify(op.otherKwargs || {}, null, 2)}`;
    })
    .join("\n");

  // Format bookmarks
  const bookmarksDetails = bookmarks
    .map((bookmark: Bookmark) => {
      return `
- Text: "${bookmark.text}"
  Source: ${bookmark.source}
  Context: ${bookmark.notes[0].note || "None"}`;
    })
    .join("\n");

  return `Current Pipeline State:
Pipeline Name: "${state.pipelineName}"

Input Dataset File: ${
    state.currentFile ? `"${state.currentFile.name}"` : "None"
  }

Pipeline operations:${operationsDetails}

My notes:${bookmarks.length > 0 ? bookmarksDetails : "\nNo notes added yet"}
${
  currentOperationName && outputSample
    ? `
Operation just executed: ${currentOperationName}

Schema Information:
${schemaInfo}

Sample output for current operation (the LLM-generated outputs for this operation are bolded; other keys from other operations or the original input file are included but not bolded):
${outputSample}`
    : ""
}`;
};

export const PipelineProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, setState] = useState<PipelineState>(() => ({
    operations: loadFromLocalStorage(
      localStorageKeys.OPERATIONS_KEY,
      initialOperations
    ),
    currentFile: loadFromLocalStorage(localStorageKeys.CURRENT_FILE_KEY, null),
    output: loadFromLocalStorage(localStorageKeys.OUTPUT_KEY, null),
    terminalOutput: loadFromLocalStorage(
      localStorageKeys.TERMINAL_OUTPUT_KEY,
      ""
    ),
    optimizerProgress: null,
    isLoadingOutputs: loadFromLocalStorage(
      localStorageKeys.IS_LOADING_OUTPUTS_KEY,
      false
    ),
    numOpRun: loadFromLocalStorage(localStorageKeys.NUM_OP_RUN_KEY, 0),
    pipelineName: loadFromLocalStorage(
      localStorageKeys.PIPELINE_NAME_KEY,
      mockPipelineName
    ),
    sampleSize: loadFromLocalStorage(
      localStorageKeys.SAMPLE_SIZE_KEY,
      mockSampleSize
    ),
    files: loadFromLocalStorage(localStorageKeys.FILES_KEY, mockFiles),
    cost: loadFromLocalStorage(localStorageKeys.COST_KEY, 0),
    defaultModel: loadFromLocalStorage(
      localStorageKeys.DEFAULT_MODEL_KEY,
      "gpt-4o-mini"
    ),
    optimizerModel: loadFromLocalStorage(
      localStorageKeys.OPTIMIZER_MODEL_KEY,
      "gpt-4o-mini"
    ),
  }));

  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const saveProgress = useCallback(() => {
    localStorage.setItem(
      localStorageKeys.OPERATIONS_KEY,
      JSON.stringify(stateRef.current.operations)
    );
    localStorage.setItem(
      localStorageKeys.CURRENT_FILE_KEY,
      JSON.stringify(stateRef.current.currentFile)
    );
    localStorage.setItem(
      localStorageKeys.OUTPUT_KEY,
      JSON.stringify(stateRef.current.output)
    );
    localStorage.setItem(
      localStorageKeys.TERMINAL_OUTPUT_KEY,
      JSON.stringify(stateRef.current.terminalOutput)
    );
    localStorage.setItem(
      localStorageKeys.IS_LOADING_OUTPUTS_KEY,
      JSON.stringify(stateRef.current.isLoadingOutputs)
    );
    localStorage.setItem(
      localStorageKeys.NUM_OP_RUN_KEY,
      JSON.stringify(stateRef.current.numOpRun)
    );
    localStorage.setItem(
      localStorageKeys.PIPELINE_NAME_KEY,
      JSON.stringify(stateRef.current.pipelineName)
    );
    localStorage.setItem(
      localStorageKeys.SAMPLE_SIZE_KEY,
      JSON.stringify(stateRef.current.sampleSize)
    );
    localStorage.setItem(
      localStorageKeys.FILES_KEY,
      JSON.stringify(stateRef.current.files)
    );
    localStorage.setItem(
      localStorageKeys.COST_KEY,
      JSON.stringify(stateRef.current.cost)
    );
    localStorage.setItem(
      localStorageKeys.DEFAULT_MODEL_KEY,
      JSON.stringify(stateRef.current.defaultModel)
    );
    localStorage.setItem(
      localStorageKeys.OPTIMIZER_MODEL_KEY,
      JSON.stringify(stateRef.current.optimizerModel)
    );
    setUnsavedChanges(false);
    console.log("Progress saved!");
  }, []);

  const setStateAndUpdate = useCallback(
    <K extends keyof PipelineState>(
      key: K,
      value:
        | PipelineState[K]
        | ((prevState: PipelineState[K]) => PipelineState[K])
    ) => {
      setState((prevState) => {
        const newValue =
          typeof value === "function"
            ? (value as (prev: PipelineState[K]) => PipelineState[K])(
                prevState[key]
              )
            : value;
        if (newValue !== prevState[key]) {
          setUnsavedChanges(true);
          return { ...prevState, [key]: newValue };
        }
        return prevState;
      });
    },
    []
  );

  const clearPipelineState = useCallback(() => {
    Object.values(localStorageKeys).forEach((key) => {
      localStorage.removeItem(key);
    });
    setState({
      operations: initialOperations,
      currentFile: null,
      output: null,
      terminalOutput: "",
      isLoadingOutputs: false,
      numOpRun: 0,
      pipelineName: mockPipelineName,
      sampleSize: mockSampleSize,
      files: mockFiles,
      cost: 0,
      defaultModel: "gpt-4o-mini",
      optimizerModel: "gpt-4o-mini",
      optimizerProgress: null,
    });
    setUnsavedChanges(false);
    console.log("Pipeline state cleared!");
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (unsavedChanges) {
        event.preventDefault();
        event.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [unsavedChanges]);

  const contextValue: PipelineContextType = {
    ...state,
    setOperations: useCallback(
      (value) => setStateAndUpdate("operations", value),
      [setStateAndUpdate]
    ),
    setCurrentFile: useCallback(
      (value) => setStateAndUpdate("currentFile", value),
      [setStateAndUpdate]
    ),
    setOutput: useCallback(
      (value) => setStateAndUpdate("output", value),
      [setStateAndUpdate]
    ),
    setTerminalOutput: useCallback(
      (value) => setStateAndUpdate("terminalOutput", value),
      [setStateAndUpdate]
    ),
    setIsLoadingOutputs: useCallback(
      (value) => setStateAndUpdate("isLoadingOutputs", value),
      [setStateAndUpdate]
    ),
    setNumOpRun: useCallback(
      (value) => setStateAndUpdate("numOpRun", value),
      [setStateAndUpdate]
    ),
    setPipelineName: useCallback(
      (value) => setStateAndUpdate("pipelineName", value),
      [setStateAndUpdate]
    ),
    setSampleSize: useCallback(
      (value) => setStateAndUpdate("sampleSize", value),
      [setStateAndUpdate]
    ),
    setFiles: useCallback(
      (value) => setStateAndUpdate("files", value),
      [setStateAndUpdate]
    ),
    setCost: useCallback(
      (value) => setStateAndUpdate("cost", value),
      [setStateAndUpdate]
    ),
    setDefaultModel: useCallback(
      (value) => setStateAndUpdate("defaultModel", value),
      [setStateAndUpdate]
    ),
    setOptimizerModel: useCallback(
      (value) => setStateAndUpdate("optimizerModel", value),
      [setStateAndUpdate]
    ),
    setOptimizerProgress: useCallback(
      (value) => setStateAndUpdate("optimizerProgress", value),
      [setStateAndUpdate]
    ),
    saveProgress,
    unsavedChanges,
    clearPipelineState,
    serializeState: useCallback(() => serializeState(stateRef.current), []),
  };

  return (
    <PipelineContext.Provider value={contextValue}>
      {children}
    </PipelineContext.Provider>
  );
};

export const usePipelineContext = () => {
  const context = useContext(PipelineContext);
  if (context === undefined) {
    throw new Error(
      "usePipelineContext must be used within a PipelineProvider"
    );
  }
  return context;
};
