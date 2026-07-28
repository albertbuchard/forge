import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SettingsOperatorGate } from "@/components/settings/settings-operator-gate";

const { refetchMock, useGetOperatorSessionQueryMock } = vi.hoisted(() => ({
  refetchMock: vi.fn(),
  useGetOperatorSessionQueryMock: vi.fn()
}));

vi.mock("@/store/api/forge-api", () => ({
  useGetOperatorSessionQuery: useGetOperatorSessionQueryMock
}));

function renderGate() {
  render(
    <MemoryRouter>
      <SettingsOperatorGate>
        <div>Privileged settings content</div>
      </SettingsOperatorGate>
    </MemoryRouter>
  );
}

describe("SettingsOperatorGate", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders settings only for a local operator session", async () => {
    useGetOperatorSessionQueryMock.mockReturnValue({
      data: {
        session: {
          localOwner: true,
          principalKind: "operator_session",
          profile: "operator"
        }
      },
      error: undefined,
      isError: false,
      isLoading: false,
      refetch: refetchMock
    });

    renderGate();

    expect(screen.getByText("Privileged settings content")).toBeInTheDocument();
  });

  it("keeps paired browsers connected without mounting privileged settings", async () => {
    useGetOperatorSessionQueryMock.mockReturnValue({
      data: {
        session: {
          localOwner: false,
          principalKind: "paired_client",
          profile: "trusted_personal_assistant"
        }
      },
      error: undefined,
      isError: false,
      isLoading: false,
      refetch: refetchMock
    });

    renderGate();

    expect(
      screen.getByText("Settings stay on the Forge host")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Privileged settings content")
    ).not.toBeInTheDocument();
  });

  it("denies an elevated paired browser even when its profile is operator", () => {
    useGetOperatorSessionQueryMock.mockReturnValue({
      data: {
        session: {
          localOwner: false,
          principalKind: "paired_client",
          profile: "operator"
        }
      },
      error: undefined,
      isError: false,
      isLoading: false,
      refetch: refetchMock
    });

    renderGate();

    expect(
      screen.getByText("Settings stay on the Forge host")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Privileged settings content")
    ).not.toBeInTheDocument();
  });

  it("does not mount privileged settings while authority is loading", () => {
    useGetOperatorSessionQueryMock.mockReturnValue({
      data: undefined,
      error: undefined,
      isError: false,
      isLoading: true,
      refetch: refetchMock
    });

    renderGate();

    expect(screen.getByText("Checking settings access")).toBeInTheDocument();
    expect(
      screen.queryByText("Privileged settings content")
    ).not.toBeInTheDocument();
  });

  it("fails closed and offers a retry when authority cannot be verified", () => {
    useGetOperatorSessionQueryMock.mockReturnValue({
      data: undefined,
      error: new Error("authority unavailable"),
      isError: true,
      isLoading: false,
      refetch: refetchMock
    });

    renderGate();

    expect(
      screen.queryByText("Privileged settings content")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
