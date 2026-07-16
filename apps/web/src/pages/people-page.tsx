import { useNavigate } from "react-router-dom";
import { PageHero } from "@/components/shell/page-hero";
import { PeopleGatewayProvider } from "@/components/people/people-gateway";
import { PeopleWorkspace } from "@/components/people/people-workspace";
import type { PeopleGateway } from "@/components/people/people-types";

function PeoplePageContent() {
  const navigate = useNavigate();
  return (
    <div className="min-h-full bg-[var(--ui-bg)]">
      <PageHero
        title={<h1>People</h1>}
        titleText="People"
        description="The people in your life."
      />
      <PeopleWorkspace
        selectedPersonId={null}
        onNavigatePerson={(personId) =>
          navigate(`/people/${encodeURIComponent(personId)}`)
        }
        onNavigateCollection={() => navigate("/people")}
      />
    </div>
  );
}

export function PeoplePage({ gateway }: { gateway?: PeopleGateway } = {}) {
  const content = <PeoplePageContent />;
  return gateway ? (
    <PeopleGatewayProvider gateway={gateway}>{content}</PeopleGatewayProvider>
  ) : (
    content
  );
}
