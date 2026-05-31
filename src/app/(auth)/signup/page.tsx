"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, CheckCircle } from "lucide-react";

export default function SignupPage() {
  const [fullName,        setFullName]        = useState("");
  const [email,           setEmail]           = useState("");
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error,           setError]           = useState<string | null>(null);
  const [loading,         setLoading]         = useState(false);
  const [success,         setSuccess]         = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) { setError("Passwords do not match"); return; }
    if (password.length < 6)          { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, password }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? "Registration failed"); setLoading(false); return; }
      await signIn("credentials", { email, password, redirect: false });
      setSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <Card className="w-full max-w-md border-slate-800 bg-slate-900">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
            <h2 className="text-xl font-semibold text-white">Account created!</h2>
            <p className="text-sm text-slate-400">Your WA-CRM account is ready.</p>
            <Link href="/login" className="mt-2 inline-flex h-10 items-center justify-center rounded-md bg-violet-600 px-6 text-sm font-medium text-white hover:bg-violet-500">
              Sign in
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10">
            <MessageSquare className="h-6 w-6 text-violet-500" />
          </div>
          <CardTitle className="text-xl text-white">Create your account</CardTitle>
          <CardDescription className="text-slate-400">Get started with WA-CRM</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName" className="text-slate-300">Full Name</Label>
              <Input id="fullName" type="text" placeholder="John Doe" value={fullName} onChange={e => setFullName(e.target.value)} required className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-violet-500 focus-visible:ring-violet-500/20" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-slate-300">Email</Label>
              <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-violet-500 focus-visible:ring-violet-500/20" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-slate-300">Password</Label>
              <Input id="password" type="password" placeholder="Min. 6 characters" value={password} onChange={e => setPassword(e.target.value)} required className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-violet-500 focus-visible:ring-violet-500/20" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword" className="text-slate-300">Confirm Password</Label>
              <Input id="confirmPassword" type="password" placeholder="Repeat password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-violet-500 focus-visible:ring-violet-500/20" />
            </div>
            <Button type="submit" disabled={loading} className="mt-2 h-10 w-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50">
              {loading ? "Creating account…" : "Create account"}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-400">
            Already have an account?{" "}
            <Link href="/login" className="text-violet-500 hover:text-violet-400">Sign in</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
