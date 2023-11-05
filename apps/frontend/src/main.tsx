import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";

import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: {
              retry: false,
              refetchIntervalInBackground: false,
              refetchOnReconnect: false,
              refetchOnWindowFocus: false,
              refetchOnMount: false,
            },
            mutations: {
              retry: false,
            },
          },
        })
      }
    >
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
