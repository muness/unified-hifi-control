package Plugins::UnifiedHiFi::Helper;

# Binary lifecycle management for Unified Hi-Fi Control
# Handles spawning, monitoring, and restarting the helper process

use strict;
use warnings;

use File::Spec::Functions qw(catfile catdir);
use Proc::Background;

use Slim::Utils::Log;
use Slim::Utils::Prefs;
use Slim::Utils::OSDetect;
use Slim::Utils::Misc;
use Slim::Utils::Timers;

my $log = logger('plugin.unifiedhifi');
my $prefs = preferences('plugin.unifiedhifi');

my $helper;       # Proc::Background instance
my $binary;       # Path to selected binary
my $restarts = 0; # Restart counter

use constant HEALTH_CHECK_INTERVAL => 30;  # seconds
use constant MAX_RESTARTS          => 5;   # before giving up
use constant RESTART_RESET_TIME    => 300; # reset counter after 5 min stable

# Detect OS and return available binaries
sub binaries {
    my $class = shift;

    my $os = Slim::Utils::OSDetect::OS();
    my $details = Slim::Utils::OSDetect::details();
    my $arch = $details->{'osArch'} || $details->{'binArch'} || 'x86_64';

    my $bindir = catdir(_pluginDataFor('basedir'), 'Bin');
    my @binaries;

    if ($os eq 'win') {
        push @binaries, 'unified-hifi-win64.exe';
    }
    elsif ($os eq 'mac') {
        if ($arch =~ /arm|aarch64/i) {
            push @binaries, 'unified-hifi-darwin-arm64';
        } else {
            push @binaries, 'unified-hifi-darwin-x86_64';
        }
    }
    else {
        # Linux and other Unix-like systems
        if ($arch =~ /x86_64|amd64/i) {
            push @binaries, 'unified-hifi-linux-x86_64';
        }
        elsif ($arch =~ /aarch64|arm64/i) {
            push @binaries, 'unified-hifi-linux-aarch64';
        }
        elsif ($arch =~ /arm/i) {
            push @binaries, 'unified-hifi-linux-armv7l';
        }
        else {
            # Fallback to x86_64
            push @binaries, 'unified-hifi-linux-x86_64';
        }
    }

    # Filter to only existing files
    my @available;
    for my $bin (@binaries) {
        my $path = catfile($bindir, $bin);
        push @available, $bin if -e $path;
    }

    $log->debug("Available binaries for $os/$arch: " . join(', ', @available));
    return @available;
}

# Get path to the selected binary
sub bin {
    my $class = shift;

    my $bindir = catdir(_pluginDataFor('basedir'), 'Bin');
    my @available = $class->binaries();

    return unless @available;

    # Use preference or default to first available
    my $selected = $prefs->get('bin') || $available[0];

    # Validate selection
    unless (grep { $_ eq $selected } @available) {
        $selected = $available[0];
        $prefs->set('bin', $selected);
    }

    return catfile($bindir, $selected);
}

# Start the helper process
sub start {
    my $class = shift;

    return if $helper && $helper->alive;

    $binary = $class->bin();
    unless ($binary && -e $binary) {
        $log->error("No suitable binary found for this platform");
        return;
    }

    my $port = $prefs->get('port') || 8088;
    my $loglevel = $prefs->get('loglevel') || 'info';

    # Make executable on Unix
    if (Slim::Utils::OSDetect::OS() ne 'win') {
        chmod 0755, $binary;
    }

    # Build command line
    my @cmd = ($binary);

    # Set environment variables (the Node.js app reads these)
    $ENV{PORT} = $port;
    $ENV{LOG_LEVEL} = $loglevel;
    $ENV{CONFIG_DIR} = Slim::Utils::OSDetect::dirsFor('prefs');

    # Pass LMS connection info so bridge can auto-discover
    my $lmsPort = $Slim::Web::HTTP::localPort || 9000;
    $ENV{LMS_HOST} = 'localhost';
    $ENV{LMS_PORT} = $lmsPort;

    $log->info("Starting Unified Hi-Fi Control: $binary on port $port");

    eval {
        $helper = Proc::Background->new({'die_upon_destroy' => 1}, @cmd);
    };

    if ($@ || !$helper) {
        $log->error("Failed to start helper: $@");
        return;
    }

    # Schedule health checks
    Slim::Utils::Timers::setTimer($class, time() + HEALTH_CHECK_INTERVAL, \&_healthCheck);

    return 1;
}

# Stop the helper process
sub stop {
    my $class = shift;

    Slim::Utils::Timers::killTimers($class, \&_healthCheck);
    Slim::Utils::Timers::killTimers($class, \&_resetRestarts);

    if ($helper && $helper->alive) {
        $log->info("Stopping Unified Hi-Fi Control");
        $helper->die;
        $helper = undef;
    }

    $restarts = 0;
}

# Check if running
sub running {
    return $helper && $helper->alive;
}

# Get the web UI URL
sub webUrl {
    my $class = shift;
    my $port = $prefs->get('port') || 8088;
    return "http://localhost:$port";
}

# Health check timer callback
sub _healthCheck {
    my $class = shift;

    if ($prefs->get('autorun')) {
        if (!$helper || !$helper->alive) {
            $log->warn("Helper process died unexpectedly");

            if ($restarts < MAX_RESTARTS) {
                $restarts++;
                $log->info("Restarting helper (attempt $restarts/" . MAX_RESTARTS . ")");
                $class->start();
            } else {
                $log->error("Max restarts exceeded, giving up");
                return;
            }
        } else {
            # Process is healthy, schedule restart counter reset
            if ($restarts > 0) {
                Slim::Utils::Timers::killTimers($class, \&_resetRestarts);
                Slim::Utils::Timers::setTimer(
                    $class,
                    time() + RESTART_RESET_TIME,
                    \&_resetRestarts
                );
            }
        }

        # Schedule next health check
        Slim::Utils::Timers::setTimer(
            $class,
            time() + HEALTH_CHECK_INTERVAL,
            \&_healthCheck
        );
    }
}

sub _resetRestarts {
    $restarts = 0;
}

sub _pluginDataFor {
    my $key = shift;
    return Slim::Utils::PluginManager->dataForPlugin(__PACKAGE__)->{$key};
}

1;

__END__

=head1 NAME

Plugins::UnifiedHiFi::Helper - Binary lifecycle management

=head1 DESCRIPTION

Manages the unified-hifi-control binary: spawning, monitoring, and restarting.

=cut
