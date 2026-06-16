import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CreditCard, TrendingUp, CheckCircle, Clock, XCircle, Search, X, Hash } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Clinician, Client } from "@shared/schema";

type ChargeWithClient = {
  id: string;
  clientId: string;
  amountPence: number;
  stripePaymentIntentId: string | null;
  status: string;
  notes: string | null;
  chargedByUserId: string | null;
  chargedAt: string | null;
  tenantId: string | null;
  clientDisplayId: string;
  clinicianName: string | null;
};

type ClinicianWithName = Clinician & { name: string };

function formatGBP(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  if (status === "succeeded") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 gap-1" variant="outline" data-testid="badge-status-succeeded">
        <CheckCircle className="h-3 w-3" /> Succeeded
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200 gap-1" variant="outline" data-testid="badge-status-failed">
        <XCircle className="h-3 w-3" /> Failed
      </Badge>
    );
  }
  return (
    <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 gap-1" variant="outline" data-testid="badge-status-pending">
      <Clock className="h-3 w-3" /> Pending
    </Badge>
  );
}

export default function Payments() {
  const now = new Date();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [clinicianFilter, setClinicianFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const { data: charges = [], isLoading } = useQuery<ChargeWithClient[]>({
    queryKey: ["/api/stripe/charges"],
    queryFn: async () => {
      const res = await fetch("/api/stripe/charges", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch charges");
      return res.json();
    },
  });

  const { data: clinicians = [] } = useQuery<ClinicianWithName[]>({
    queryKey: ["/api/clinicians"],
    queryFn: async () => {
      const res = await fetch("/api/clinicians", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: allClients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const uniqueClinicians = useMemo(() => {
    const names = new Set<string>();
    const result: string[] = [];
    charges.forEach(c => {
      if (c.clinicianName && !names.has(c.clinicianName)) {
        names.add(c.clinicianName);
        result.push(c.clinicianName);
      }
    });
    return result.sort();
  }, [charges]);

  const filtered = useMemo(() => {
    return charges.filter(c => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (clinicianFilter !== "all" && c.clinicianName !== clinicianFilter) return false;
      if (fromDate) {
        const charged = c.chargedAt ? new Date(c.chargedAt) : null;
        if (!charged || charged < new Date(fromDate)) return false;
      }
      if (toDate) {
        const charged = c.chargedAt ? new Date(c.chargedAt) : null;
        if (!charged || charged > new Date(toDate + "T23:59:59")) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!c.clientDisplayId.toLowerCase().includes(q) && !(c.clinicianName ?? "").toLowerCase().includes(q) && !(c.notes ?? "").toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [charges, statusFilter, clinicianFilter, fromDate, toDate, search]);

  const summaryCards = useMemo(() => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const totalRevenue = charges
      .filter(c => c.status === "succeeded")
      .reduce((sum, c) => sum + c.amountPence, 0);

    const thisMonthRevenue = charges
      .filter(c => c.status === "succeeded" && c.chargedAt && new Date(c.chargedAt) >= monthStart)
      .reduce((sum, c) => sum + c.amountPence, 0);

    const totalCharges = charges.length;

    const activeSetups = allClients.filter(c => c.paymentStatus === "active").length;

    const pendingCount = charges.filter(c => c.status === "pending").length;

    return { totalRevenue, thisMonthRevenue, totalCharges, activeSetups, pendingCount };
  }, [charges, allClients]);

  const monthlyRevenue = useMemo(() => {
    const months: { label: string; year: number; month: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
        year: d.getFullYear(),
        month: d.getMonth(),
      });
    }
    const succeeded = charges.filter(c => c.status === "succeeded" && c.chargedAt);
    return months.map(({ label, year, month }) => {
      const total = succeeded
        .filter(c => {
          const d = new Date(c.chargedAt!);
          return d.getFullYear() === year && d.getMonth() === month;
        })
        .reduce((sum, c) => sum + c.amountPence, 0);
      return { label, revenue: parseFloat((total / 100).toFixed(2)) };
    });
  }, [charges]);

  const hasFilters = statusFilter !== "all" || clinicianFilter !== "all" || fromDate || toDate || search;

  function clearFilters() {
    setStatusFilter("all");
    setClinicianFilter("all");
    setFromDate("");
    setToDate("");
    setSearch("");
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <p className="text-sm text-gray-500 mt-1">Revenue and charge history across all clients</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-revenue-this-month">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Revenue This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900" data-testid="value-revenue-this-month">
              {formatGBP(summaryCards.thisMonthRevenue)}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-revenue">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-blue-500" />
              Total Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900" data-testid="value-total-revenue">
              {formatGBP(summaryCards.totalRevenue)}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-charges">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Hash className="h-4 w-4 text-indigo-500" />
              Total Charges
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900" data-testid="value-total-charges">
              {summaryCards.totalCharges}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-active-payment-setups">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-purple-500" />
              Active Payment Setups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900" data-testid="value-active-payment-setups">
              {summaryCards.activeSetups}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Trend Chart */}
      <Card data-testid="card-revenue-trend">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            Monthly Revenue — Last 12 Months
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={220} data-testid="chart-revenue-trend">
              <BarChart data={monthlyRevenue} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={v => `£${v}`}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
                <Tooltip
                  formatter={(value: number) => [`£${value.toFixed(2)}`, "Revenue"]}
                  contentStyle={{ fontSize: 12, borderRadius: 6 }}
                  cursor={{ fill: "#f9fafb" }}
                />
                <Bar dataKey="revenue" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Charge History</CardTitle>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters" className="text-gray-500 gap-1">
                <X className="h-4 w-4" /> Clear filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  className="pl-8"
                  placeholder="Client ID, clinician…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  data-testid="input-search"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="select-status">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="succeeded">Succeeded</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Clinician</Label>
              <Select value={clinicianFilter} onValueChange={setClinicianFilter}>
                <SelectTrigger data-testid="select-clinician">
                  <SelectValue placeholder="All clinicians" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clinicians</SelectItem>
                  {uniqueClinicians.map(name => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">From</Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  data-testid="input-date-from"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">To</Label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  data-testid="input-date-to"
                />
              </div>
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="text-center py-12 text-gray-400">Loading charges…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400" data-testid="text-empty-charges">
              No charges found
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Client</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Clinician</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Amount</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(charge => (
                    <tr key={charge.id} className="hover:bg-gray-50" data-testid={`row-charge-${charge.id}`}>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap" data-testid={`text-charge-date-${charge.id}`}>
                        {formatDate(charge.chargedAt)}
                      </td>
                      <td className="px-4 py-3" data-testid={`text-charge-client-${charge.id}`}>
                        <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                          {charge.clientDisplayId || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700" data-testid={`text-charge-clinician-${charge.id}`}>
                        {charge.clinicianName ?? <span className="text-gray-400">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap" data-testid={`text-charge-amount-${charge.id}`}>
                        {formatGBP(charge.amountPence)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={charge.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-xs truncate" data-testid={`text-charge-notes-${charge.id}`}>
                        {charge.notes ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2 bg-gray-50 border-t text-xs text-gray-500 flex justify-between">
                <span data-testid="text-charge-count">
                  {filtered.length} charge{filtered.length !== 1 ? "s" : ""}
                  {hasFilters ? " (filtered)" : ""}
                </span>
                <span data-testid="text-filtered-total">
                  Total shown: {formatGBP(filtered.filter(c => c.status === "succeeded").reduce((s, c) => s + c.amountPence, 0))}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
