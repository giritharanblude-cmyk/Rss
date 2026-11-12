import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DashboardCharts } from './DashboardCharts';

vi.mock('react-chartjs-2', () => {
  const MockChart = ({ data }: { data: { labels: string[]; datasets: { data: number[] }[] } }) => (
    <div
      data-testid="rendered-chart"
      data-labels={data.labels.join('|')}
      data-values={data.datasets.map((dataset) => dataset.data.join(':')).join('|')}
    />
  );
  return { Bar: MockChart, Doughnut: MockChart, Pie: MockChart };
});

const chartData = {
  connections: { whatsapp: true, email: false },
  dailyActivity: [
    { date: '2026-11-06', items: 1, deliveries: 0 },
    { date: '2026-11-07', items: 0, deliveries: 2 },
  ],
  deliveryOutcomes: { delivered: 8, failed: 2 },
};

describe('DashboardCharts', () => {
  it('renders all three charts from dashboard data', () => {
    render(<DashboardCharts data={chartData} />);

    expect(
      within(screen.getByRole('img', { name: 'Connection states pie chart' })).getByTestId(
        'rendered-chart',
      ),
    ).toHaveAttribute('data-values', '1:1');
    expect(
      within(screen.getByRole('img', { name: 'Items and deliveries bar chart' })).getByTestId(
        'rendered-chart',
      ),
    ).toHaveAttribute('data-values', '1:0|0:2');
    expect(
      within(
        screen.getByRole('img', { name: 'Delivery success and failure donut chart' }),
      ).getByTestId('rendered-chart'),
    ).toHaveAttribute('data-values', '8:2');
  });

  it('shows an empty state for each chart when the dashboard has no chart data', () => {
    render(
      <DashboardCharts
        data={{
          connections: null,
          dailyActivity: [],
          deliveryOutcomes: { delivered: 0, failed: 0 },
        }}
      />,
    );

    expect(screen.getByText('No connection status data yet.')).toBeInTheDocument();
    expect(
      screen.getByText('No item or delivery activity in the last 7 days.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No completed delivery outcomes yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('rendered-chart')).not.toBeInTheDocument();
  });
});
