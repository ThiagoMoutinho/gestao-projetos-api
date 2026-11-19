import { sql, type SQL } from "drizzle-orm";

import type { DbClient } from "../../db/types";
import type { SearchKind, SearchResult } from "./search.schema";
import { excerpt, likePattern, SQL_ACCENTED, SQL_PLAIN } from "./search.text";

/** Quem pode ser alcançado pela busca: todos os projetos (ADMIN, PMO, COORDENADOR) ou só os do usuário (dono ou membro). */
export type SearchScope = { all: true } | { all: false; userId: string };

export type SearchInput = {
  words: readonly string[];
  scope: SearchScope;
  perKind: number;
  /** Pessoas só entram para quem já enxerga todos os projetos (privilégio mínimo: nome e e-mail são dados pessoais). */
  includePeople: boolean;
};

export interface SearchRepository {
  search(input: SearchInput): Promise<SearchResult[]>;
}

const PROFILE_FIELD_LABEL: Record<string, string> = {
  PURPOSE: "Propósito",
  SCOPE: "Escopo",
  PROBLEM: "Problema",
  REQUESTING_AREA: "Área solicitante",
  RESPONSIBLE_COMPANY: "Empresa responsável",
  BENEFITED_SECTORS: "Setores beneficiados",
  SYSTEM_DESCRIPTION: "Descrição do sistema",
  RESULTS_SUMMARY: "Resumo dos resultados",
};

const RESULT_TYPE_LABEL: Record<string, string> = { ESPERADO: "Resultado esperado", ALCANCADO: "Resultado alcançado" };
const EVIDENCE_KIND_LABEL: Record<string, string> = {
  MINUTES: "Ata",
  REPORT: "Relatório",
  DOCUMENT: "Documento",
  GLPI_TICKET: "Chamado GLPI",
  OTHER: "Outra evidência",
};
const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  PMO: "PMO",
  COORDENADOR: "Coordenação",
  GESTOR: "Gestor",
  FORNECEDOR: "Fornecedor",
  COLABORADOR: "Colaborador",
};

type Row = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const required = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));
const join = (parts: ReadonlyArray<string | null>) => parts.filter((part): part is string => Boolean(part)).join(" · ") || null;

/** Texto sem acento, em minúsculas e sem pontuação, com um espaço na frente (mesma tabela de pares de foldText). */
function fold(expression: SQL): SQL {
  return sql`' ' || regexp_replace(translate(lower(coalesce(${expression}, '')), ${SQL_ACCENTED}, ${SQL_PLAIN}), '[^a-z0-9]+', ' ', 'g')`;
}

/** Todas as palavras precisam começar alguma palavra do conjunto de colunas (em qualquer ordem). */
function matchAll(columns: readonly SQL[], words: readonly string[]): SQL {
  const haystack = fold(sql`concat_ws(' ', ${sql.join([...columns], sql`, `)})`);
  const conditions = words.map((word) => sql`${haystack} like ${likePattern(word)} escape '\\'`);
  return sql.join(conditions, sql` and `);
}

/** O projeto `p` só vale se o usuário puder vê-lo: papel global amplo, dono ou membro. */
function access(scope: SearchScope): SQL {
  if (scope.all) {
    return sql`true`;
  }
  return sql`(p.owner_id = ${scope.userId} or exists (select 1 from project_members pm where pm.project_id = p.id and pm.user_id = ${scope.userId}))`;
}

/** Drizzle/node-postgres: `execute` devolve `{ rows }`. */
async function rowsOf(client: DbClient, query: SQL): Promise<Row[]> {
  const result = await client.execute(query);
  return result.rows as Row[];
}

function item(kind: SearchKind, row: Row, title: string, detail: string | null, destination: "OVERVIEW" | "EAP"): SearchResult {
  return { kind, id: required(row.id), title, detail, projectId: required(row.project_id), projectName: required(row.project_name), destination };
}

export class DrizzleSearchRepository implements SearchRepository {
  constructor(private readonly client: DbClient) {}

  async search(input: SearchInput): Promise<SearchResult[]> {
    const { words, scope, perKind } = input;
    const groups = await Promise.all([
      this.projects(words, scope, perKind),
      this.evidences(words, scope, perKind, "GLPI_TICKET"),
      this.evidences(words, scope, perKind, "MINUTES"),
      this.phases(words, scope, perKind),
      this.tasks(words, scope, perKind),
      this.milestones(words, scope, perKind),
      this.evidences(words, scope, perKind, "OTHERS"),
      this.deliveries(words, scope, perKind),
      this.profiles(words, scope, perKind),
      this.results(words, scope, perKind),
      this.impediments(words, scope, perKind),
      input.includePeople ? this.people(words, perKind) : Promise.resolve([]),
    ]);
    return groups.flat();
  }

  private async projects(words: readonly string[], scope: SearchScope, limit: number) {
    const rows = await rowsOf(
      this.client,
      sql`select p.id, p.id as project_id, p.name as project_name, p.description, p.glpi_ticket_id, p.pmo_glpi_ticket_id
        from projects p
        where ${access(scope)} and ${matchAll([sql`p.name`, sql`p.description`, sql`p.glpi_ticket_id`, sql`p.pmo_glpi_ticket_id`, sql`case when p.glpi_ticket_id is not null or p.pmo_glpi_ticket_id is not null then 'glpi chamado' end`], words)}
        order by p.name limit ${limit}`,
    );
    return rows.map((row) =>
      item(
        "PROJECT",
        row,
        required(row.project_name),
        join([
          text(row.glpi_ticket_id) ? `GLPI #${required(row.glpi_ticket_id)}` : null,
          text(row.pmo_glpi_ticket_id) ? `Solicitação PMO #${required(row.pmo_glpi_ticket_id)}` : null,
          excerpt(text(row.description), words, 80),
        ]),
        "OVERVIEW",
      ),
    );
  }

  private async phases(words: readonly string[], scope: SearchScope, limit: number) {
    const rows = await rowsOf(
      this.client,
      sql`select ph.id, ph.name as title, ph.description, p.id as project_id, p.name as project_name
        from eap_phases ph join projects p on p.id = ph.project_id
        where ${access(scope)} and ${matchAll([sql`ph.name`, sql`ph.description`, sql`'fase'`], words)}
        order by p.name, ph.sort_order limit ${limit}`,
    );
    return rows.map((row) => item("PHASE", row, required(row.title), join([`Fase · ${required(row.project_name)}`, excerpt(text(row.description), words, 70)]), "EAP"));
  }

  private async tasks(words: readonly string[], scope: SearchScope, limit: number) {
    const rows = await rowsOf(
      this.client,
      sql`select t.id, t.title, t.description, t.parent_task_id, ph.name as phase_name, p.id as project_id, p.name as project_name
        from eap_tasks t join eap_phases ph on ph.id = t.phase_id join projects p on p.id = ph.project_id
        where ${access(scope)} and ${matchAll([sql`t.title`, sql`t.description`, sql`case when t.parent_task_id is null then 'tarefa' else 'subtarefa tarefa' end`], words)}
        order by p.name, ph.sort_order, t.sort_order limit ${limit}`,
    );
    return rows.map((row) =>
      item("TASK", row, required(row.title), join([`${text(row.parent_task_id) ? "Subtarefa" : "Tarefa"} · ${required(row.phase_name)}`, excerpt(text(row.description), words, 70)]), "EAP"),
    );
  }

  private async milestones(words: readonly string[], scope: SearchScope, limit: number) {
    const rows = await rowsOf(
      this.client,
      sql`select m.id, m.title, m.description, ph.name as phase_name, p.id as project_id, p.name as project_name
        from eap_milestones m join eap_phases ph on ph.id = m.phase_id join projects p on p.id = ph.project_id
        where ${access(scope)} and ${matchAll([sql`m.title`, sql`m.description`, sql`'marco'`], words)}
        order by p.name, ph.sort_order, m.sort_order limit ${limit}`,
    );
    return rows.map((row) => item("MILESTONE", row, required(row.title), join([`Marco · ${required(row.phase_name)}`, excerpt(text(row.description), words, 70)]), "EAP"));
  }

  /** Atas, chamados GLPI e demais evidências: o projeto vem do pai (fase, tarefa, marco, reprogramação, resultado ou o próprio projeto). */
  private async evidences(words: readonly string[], scope: SearchScope, limit: number, group: "GLPI_TICKET" | "MINUTES" | "OTHERS") {
    const filter =
      group === "OTHERS"
        ? sql`(e.kind is null or e.kind not in ('GLPI_TICKET', 'MINUTES'))`
        : sql`e.kind = ${group}`;
    const rows = await rowsOf(
      this.client,
      sql`select e.id, e.title, e.kind, e.ticket_number,
          coalesce(php.name, t.title, m.title) as parent_name,
          (e.project_id is not null or e.project_result_id is not null) as on_overview,
          p.id as project_id, p.name as project_name
        from eap_evidences e
        left join eap_phases php on php.id = e.phase_id
        left join eap_tasks t on t.id = e.task_id
        left join eap_phases pht on pht.id = t.phase_id
        left join eap_milestones m on m.id = e.milestone_id
        left join eap_phases phm on phm.id = m.phase_id
        left join eap_schedule_requests sr on sr.id = e.schedule_request_id
        left join project_results pr on pr.id = e.project_result_id
        join projects p on p.id = coalesce(e.project_id, php.project_id, pht.project_id, phm.project_id, sr.project_id, pr.project_id)
        where ${filter} and ${access(scope)}
          and ${matchAll(
            [
              sql`e.title`,
              sql`e.ticket_number`,
              sql`case e.kind when 'MINUTES' then 'ata atas' when 'REPORT' then 'relatorio' when 'DOCUMENT' then 'documento' when 'GLPI_TICKET' then 'chamado glpi' else 'evidencia' end`,
            ],
            words,
          )}
        order by e.created_at desc limit ${limit}`,
    );
    const kind: SearchKind = group === "GLPI_TICKET" ? "GLPI" : group === "MINUTES" ? "MINUTES" : "EVIDENCE";
    return rows.map((row) => {
      const label = EVIDENCE_KIND_LABEL[text(row.kind) ?? ""] ?? "Evidência";
      const ticket = text(row.ticket_number);
      const title = kind === "GLPI" && ticket ? `Chamado GLPI #${ticket}` : required(row.title);
      return item(kind, row, title, join([kind === "GLPI" ? required(row.title) : label, text(row.parent_name), required(row.project_name)]), row.on_overview ? "OVERVIEW" : "EAP");
    });
  }

  private async deliveries(words: readonly string[], scope: SearchScope, limit: number) {
    const rows = await rowsOf(
      this.client,
      sql`select i.id, i.title, i.description, i.status, v.version_label, p.id as project_id, p.name as project_name
        from project_delivery_version_items i
        join project_delivery_versions v on v.id = i.version_id
        join projects p on p.id = v.project_id
        where ${access(scope)} and ${matchAll([sql`i.title`, sql`i.description`, sql`i.document_type`, sql`v.version_label`, sql`v.notes`, sql`'entrega checklist'`], words)}
        order by v.created_at desc, i.position limit ${limit}`,
    );
    return rows.map((row) => item("DELIVERY", row, required(row.title), join([`Entrega · versão ${required(row.version_label)}`, text(row.status), required(row.project_name)]), "OVERVIEW"));
  }

  /** Só o texto publicado e validado entra: rascunhos ainda não validados não aparecem na busca. */
  private async profiles(words: readonly string[], scope: SearchScope, limit: number) {
    const rows = await rowsOf(
      this.client,
      sql`select f.id, f.field, f.published_value, p.id as project_id, p.name as project_name
        from project_profile_fields f join projects p on p.id = f.project_id
        where f.published_value is not null and ${access(scope)} and ${matchAll([sql`f.published_value`, sql`'sobre resumo projeto'`], words)}
        order by p.name limit ${limit}`,
    );
    return rows.map((row) =>
      item("PROFILE", row, PROFILE_FIELD_LABEL[required(row.field)] ?? "Sobre o projeto", join([excerpt(text(row.published_value), words), required(row.project_name)]), "OVERVIEW"),
    );
  }

  private async results(words: readonly string[], scope: SearchScope, limit: number) {
    const rows = await rowsOf(
      this.client,
      sql`select r.id, r.type, r.published_text, p.id as project_id, p.name as project_name
        from project_results r join projects p on p.id = r.project_id
        where r.published_text is not null and ${access(scope)} and ${matchAll([sql`r.published_text`, sql`'resultado'`], words)}
        order by p.name, r.created_at desc limit ${limit}`,
    );
    return rows.map((row) =>
      item("RESULT", row, RESULT_TYPE_LABEL[required(row.type)] ?? "Resultado", join([excerpt(text(row.published_text), words), required(row.project_name)]), "OVERVIEW"),
    );
  }

  private async impediments(words: readonly string[], scope: SearchScope, limit: number) {
    const rows = await rowsOf(
      this.client,
      sql`select i.id, i.description, i.resolved_at, t.title as task_title, p.id as project_id, p.name as project_name
        from eap_impediments i
        join eap_tasks t on t.id = i.task_id
        join eap_phases ph on ph.id = t.phase_id
        join projects p on p.id = ph.project_id
        where ${access(scope)} and ${matchAll([sql`i.description`, sql`i.resolution_note`, sql`'impedimento'`], words)}
        order by i.opened_at desc limit ${limit}`,
    );
    return rows.map((row) =>
      item("IMPEDIMENT", row, required(row.task_title), join([row.resolved_at ? "Impedimento resolvido" : "Impedimento aberto", excerpt(text(row.description), words, 80), required(row.project_name)]), "EAP"),
    );
  }

  /** Pessoa ativa; o resultado leva ao projeto mais recente em que ela é dono ou membro (sem projeto, não há para onde ir). */
  private async people(words: readonly string[], limit: number) {
    const users = await rowsOf(
      this.client,
      sql`select u.id, u.name, u.email, u.role from "user" u
        where u.is_active and ${matchAll([sql`u.name`, sql`u.email`], words)}
        order by u.name limit ${limit}`,
    );
    if (users.length === 0) {
      return [];
    }
    const ids = users.map((row) => required(row.id));
    const projects = await rowsOf(
      this.client,
      sql`select distinct on (x.user_id) x.user_id, p.id as project_id, p.name as project_name
        from (select owner_id as user_id, id as project_id from projects
              union all select user_id, project_id from project_members) x
        join projects p on p.id = x.project_id
        where x.user_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        order by x.user_id, p.updated_at desc`,
    );
    const byUser = new Map(projects.map((row) => [required(row.user_id), row]));
    return users.flatMap((row) => {
      const project = byUser.get(required(row.id));
      if (!project) {
        return [];
      }
      return [
        item("PERSON", { id: row.id, project_id: project.project_id, project_name: project.project_name }, required(row.name), join([ROLE_LABEL[required(row.role)] ?? null, text(row.email), required(project.project_name)]), "OVERVIEW"),
      ];
    });
  }
}
