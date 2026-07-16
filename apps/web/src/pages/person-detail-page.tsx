import { useNavigate, useParams } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { Button } from "@/components/ui/button";
import { PeopleGatewayProvider } from "@/components/people/people-gateway";
import {
  PeopleWorkspace,
  useDesktopPeopleWorkspace
} from "@/components/people/people-workspace";
import type { PeopleGateway } from "@/components/people/people-types";

function PersonDetailPageContent() {
  const { personId } = useParams();
  const navigate = useNavigate();
  const desktop = useDesktopPeopleWorkspace();

  if (!personId) {
    return (
      <div className="grid min-h-full place-items-center bg-[var(--ui-bg)] p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold text-[var(--ui-ink-strong)]">
            Person identifier is missing
          </h1>
          <Button
            type="button"
            className="mt-4"
            onClick={() => navigate("/people")}
          >
            Open People
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[var(--ui-bg)]">
      {desktop ? (
        <PageHero
          title={<h1>People</h1>}
          titleText="People"
          description="The people in your life."
        />
      ) : null}
      <PeopleWorkspace
        selectedPersonId={personId}
        onNavigatePerson={(nextPersonId) =>
          navigate(`/people/${encodeURIComponent(nextPersonId)}`)
        }
        onNavigateCollection={() => navigate("/people")}
      />
    </div>
  );
}

export function PersonDetailPage({
  gateway
}: { gateway?: PeopleGateway } = {}) {
  const content = <PersonDetailPageContent />;
  return gateway ? (
    <PeopleGatewayProvider gateway={gateway}>{content}</PeopleGatewayProvider>
  ) : (
    content
  );
}
