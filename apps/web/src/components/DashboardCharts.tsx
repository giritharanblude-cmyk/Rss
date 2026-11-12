import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { Bar, Doughnut, Pie } from 'react-chartjs-2';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Legend, Tooltip);

type ConnectionStates = { whatsapp: boolean; email: boolean };
type DailyActivity = { date: string; items: number; deliveries: number };
type DeliveryOutcomes = { delivered: number; failed: number };

type DashboardChartData = {
  connections: ConnectionStates | null;
  dailyActivity: DailyActivity[] | null;
  deliveryOutcomes: DeliveryOutcomes | null;
};

const pieOptions: ChartOptions<'pie'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom' } },
};

const barOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom' } },
  scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
};

const doughnutOptions: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom' } },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isConnections(value: unknown): value is ConnectionStates {
  return isRecord(value) && typeof value.whatsapp === 'boolean' && typeof value.email === 'boolean';
}

function isDailyActivity(value: unknown): value is DailyActivity[] {
  return (
    Array.isArray(value) &&
    value.every(
      (day) =>
        isRecord(day) &&
        typeof day.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
        isCount(day.items) &&
        isCount(day.deliveries),
    )
  );
}

function isDeliveryOutcomes(value: unknown): value is DeliveryOutcomes {
  return isRecord(value) && isCount(value.delivered) && isCount(value.failed);
}

function readChartData(value: unknown): DashboardChartData {
  if (!isRecord(value)) {
    return { connections: null, dailyActivity: null, deliveryOutcomes: null };
  }
  return {
    connections: isConnections(value.connections) ? value.connections : null,
    dailyActivity: isDailyActivity(value.dailyActivity) ? value.dailyActivity : null,
    deliveryOutcomes: isDeliveryOutcomes(value.deliveryOutcomes) ? value.deliveryOutcomes : null,
  };
}

function dateLabel(value: string): string {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function DashboardCharts({ data }: { data: unknown }) {
  const { connections, dailyActivity, deliveryOutcomes } = readChartData(data);
  const connected = connections ? Number(connections.whatsapp) + Number(connections.email) : 0;
  const disconnected = connections ? 2 - connected : 0;
  const hasActivity = dailyActivity?.some((day) => day.items > 0 || day.deliveries > 0) ?? false;
  const outcomeTotal = deliveryOutcomes ? deliveryOutcomes.delivered + deliveryOutcomes.failed : 0;

  const connectionData: ChartData<'pie', number[], string> = {
    labels: ['Connected', 'Disconnected'],
    datasets: [
      {
        data: [connected, disconnected],
        backgroundColor: ['#2f9e44', '#c92a2a'],
      },
    ],
  };
  const activityData: ChartData<'bar', number[], string> = {
    labels: dailyActivity?.map((day) => dateLabel(day.date)) ?? [],
    datasets: [
      {
        label: 'Items',
        data: dailyActivity?.map((day) => day.items) ?? [],
        backgroundColor: '#1864ab',
      },
      {
        label: 'Deliveries',
        data: dailyActivity?.map((day) => day.deliveries) ?? [],
        backgroundColor: '#f08c00',
      },
    ],
  };
  const outcomesData: ChartData<'doughnut', number[], string> = {
    labels: ['Delivered', 'Failed'],
    datasets: [
      {
        data: [deliveryOutcomes?.delivered ?? 0, deliveryOutcomes?.failed ?? 0],
        backgroundColor: ['#2f9e44', '#c92a2a'],
      },
    ],
  };

  return (
    <section className="dashboard-chart-grid" aria-label="Dashboard charts">
      <article className="dashboard-chart-card">
        <h2>Connection states</h2>
        {connections ? (
          <>
            <div
              className="dashboard-chart-canvas"
              role="img"
              aria-label="Connection states pie chart"
            >
              <Pie data={connectionData} options={pieOptions} />
            </div>
            <p className="chart-summary">
              Connected: {connected} · Disconnected: {disconnected}
            </p>
          </>
        ) : (
          <p className="empty-state">No connection status data yet.</p>
        )}
      </article>

      <article className="dashboard-chart-card">
        <h2>Items and deliveries per day</h2>
        {hasActivity ? (
          <>
            <div
              className="dashboard-chart-canvas"
              role="img"
              aria-label="Items and deliveries bar chart"
            >
              <Bar data={activityData} options={barOptions} />
            </div>
            <p className="chart-summary">Daily totals for the last 7 days</p>
          </>
        ) : (
          <p className="empty-state">No item or delivery activity in the last 7 days.</p>
        )}
      </article>

      <article className="dashboard-chart-card">
        <h2>Delivery outcomes</h2>
        {outcomeTotal > 0 ? (
          <>
            <div
              className="dashboard-chart-canvas"
              role="img"
              aria-label="Delivery success and failure donut chart"
            >
              <Doughnut data={outcomesData} options={doughnutOptions} />
            </div>
            <p className="chart-summary">
              Delivered: {deliveryOutcomes?.delivered ?? 0} · Failed:{' '}
              {deliveryOutcomes?.failed ?? 0}
            </p>
          </>
        ) : (
          <p className="empty-state">No completed delivery outcomes yet.</p>
        )}
      </article>
    </section>
  );
}
