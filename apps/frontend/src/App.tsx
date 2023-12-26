import { useMutation } from "@tanstack/react-query";
import { File, Upload } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import {
  Button,
  DropZone,
  DropZoneProps,
  FileDropItem,
  FileTrigger,
  FileTriggerProps,
} from "react-aria-components";
import { object, parse, record, string } from "valibot";

interface Document {
  file: File;
  id: string;
}

export function App() {
  const [documents, setDocuments] = useState<Document[]>([]);

  const handleOnSelect: FileTriggerProps["onSelect"] = (fileList) => {
    if (!fileList) {
      return;
    }

    const newDocuments = Array.from(fileList).map((newFile) => {
      return { file: newFile, id: crypto.randomUUID() };
    });
    setDocuments([...documents, ...newDocuments]);
  };

  const handleOnDrop: DropZoneProps["onDrop"] = ({ items }) => {
    const validDroppedDocuments = items.filter((item): item is FileDropItem => {
      if (item.kind !== "file") {
        return false;
      }

      if (item.type !== "application/pdf") {
        return false;
      }

      return true;
    });

    Promise.all(validDroppedDocuments.map((item) => item.getFile()))
      .then((newFiles) => {
        const uploadedItems = newFiles.map((newFile) => {
          return { file: newFile, id: crypto.randomUUID() };
        });
        setDocuments([...uploadedItems, ...uploadedItems]);
      })
      .catch(console.error);
  };

  return (
    <article className={"m-auto max-w-lg py-16 flex flex-col gap-8"}>
      <h1 className={"text-3xl text-center"}>PDF to Prompt</h1>
      <DocumentDropZone
        handleOnDrop={handleOnDrop}
        handleOnSelect={handleOnSelect}
      />
      <section>
        <h2 className={"text-2xl"}>Uploaded documents</h2>
        <DocumentsList documents={documents} />
      </section>
    </article>
  );
}

interface DocumentsListProps {
  documents: Document[];
}

const DocumentsList = ({ documents }: DocumentsListProps) => {
  return (
    <ul className={"flex flex-col gap-4 mt-4"}>
      {documents.map((document) => {
        return <LocalFileItem document={document} key={document.id} />;
      })}
    </ul>
  );
};

interface LocalFileItemProps {
  document: Document;
}

const LocalFileItem = ({ document }: LocalFileItemProps) => {
  const { mutateAsync: uploadItem, isPending } = useUploadDocument();

  useLayoutEffect(() => {
    void uploadItem(document);
  }, [uploadItem, document]);

  return (
    <a
      data-loading={isPending}
      className={
        "p-4 bg-base-300 rounded-md border-2 border-neutral data-[loading='true']:opacity-50"
      }
    >
      <div className={"flex flex-row gap-2"}>
        <File />
        <span className={"italic"}>{document.file.name}</span>
        {isPending ? (
          <span className={"ml-auto loading loading-dots loading-sm"}></span>
        ) : null}
      </div>
    </a>
  );
};

const GetUploadUrlResponse = object({
  url: string(),
  fields: record(string()),
});

/**
 * So that we do not upload the same item twice in development.
 */
const uploadedDocuments = new Set<string>();

const useUploadDocument = () => {
  return useMutation({
    onSuccess: ({ id }) => {
      uploadedDocuments.add(id);
    },
    mutationFn: async (document: Document) => {
      const { file, id } = document;
      if (uploadedDocuments.has(id)) {
        return { id };
      }

      const url = new URL("generate-upload-link", import.meta.env.VITE_API_URL);
      const presignedUrlResponse = await fetch(url.toString(), {
        method: "POST",
        body: JSON.stringify({ name: file.name, size: file.size }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!presignedUrlResponse.ok) {
        throw new Error(await presignedUrlResponse.text());
      }
      const presignedUrlPayload = parse(
        GetUploadUrlResponse,
        await presignedUrlResponse.json()
      );

      const formData = new FormData();
      Object.entries(presignedUrlPayload.fields).forEach(([field, value]) => {
        formData.append(field, value);
      });
      formData.append("file", file);

      const uploadResponse = await fetch(presignedUrlPayload.url, {
        method: "POST",
        body: formData,
      });
      if (!uploadResponse.ok) {
        throw new Error(await uploadResponse.text());
      }

      return { id };
    },
  });
};

interface FileDropZoneProps {
  handleOnDrop: NonNullable<DropZoneProps["onDrop"]>;
  handleOnSelect: NonNullable<FileTriggerProps["onSelect"]>;
}

function DocumentDropZone({ handleOnDrop, handleOnSelect }: FileDropZoneProps) {
  return (
    <DropZone
      onDrop={handleOnDrop}
      className={
        "h-64 bg-base-300 flex items-center justify-center rounded-md border-neutral border-2 data-[drop-target]:border-info"
      }
    >
      <FileTrigger
        allowsMultiple={false}
        acceptedFileTypes={["application/pdf"]}
        onSelect={handleOnSelect}
      >
        <Button
          className={
            "flex flex-col items-center gap-2 w-full h-full cursor-pointer justify-center"
          }
        >
          <Upload />
          <span
            className={"uppercase font-semibold justify-center select-none"}
          >
            Select document
          </span>
        </Button>
      </FileTrigger>
    </DropZone>
  );
}
